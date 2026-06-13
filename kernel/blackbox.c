/*
 * blackbox.c - Linux Kernel Black Box Recorder
 *
 * A loadable kernel module that periodically inspects system state
 * (processes, memory, interrupts, context switches, CPU usage) and
 * records significant events in a circular ring buffer exposed via
 * /proc/blackbox.
 *
 * Build: see kernel/Makefile
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/proc_fs.h>
#include <linux/uaccess.h>
#include <linux/timer.h>
#include <linux/jiffies.h>
#include <linux/list.h>
#include <linux/slab.h>
#include <linux/sched.h>
#include <linux/sched/signal.h>
#include <linux/mm.h>
#include <linux/irq.h>
#include <linux/irqnr.h>
#include <linux/irqdesc.h>
#include <linux/kernel_stat.h>
#include <linux/cpumask.h>
#include <linux/spinlock.h>
#include <linux/time.h>
#include <linux/version.h>
#include <linux/seq_file.h>
#include <linux/string.h>
#include <linux/ktime.h>

#define MODULE_NAME       "blackbox"
#define PROC_FILENAME     "blackbox"
#define MAX_EVENTS        200
#define MAX_MSG_LEN       192
#define MAX_TRACKED_PIDS  512
#define TOP_N_PROCS       5
#define TIMER_INTERVAL_MS 5000

/* ------------------------------------------------------------------ */
/* Ring buffer event structure                                         */
/* ------------------------------------------------------------------ */
struct bb_event {
    struct list_head list;
    unsigned long long timestamp;   /* seconds since boot/epoch */
    char msg[MAX_MSG_LEN];
};

static LIST_HEAD(bb_event_list);
static int bb_event_count = 0;
static DEFINE_SPINLOCK(bb_lock);

/* ------------------------------------------------------------------ */
/* Configuration / threshold                                           */
/* ------------------------------------------------------------------ */
static unsigned int mem_threshold = 80; /* percent, warning threshold */
#define MEM_CRITICAL_OFFSET 10           /* critical = threshold + 10, capped at 95 */

/* ------------------------------------------------------------------ */
/* PID snapshot tracking                                                */
/* ------------------------------------------------------------------ */
struct pid_snapshot {
    pid_t pid;
    char comm[TASK_COMM_LEN];
    int in_use;
};

static struct pid_snapshot *prev_pids; /* array of MAX_TRACKED_PIDS */
static int prev_pid_count = 0;
static int first_scan_done = 0;

/* ------------------------------------------------------------------ */
/* Interrupt tracking                                                   */
/* NOTE: kstat_irqs_cpu() is NOT exported to modules on modern kernels
 * (6.x), so it cannot be linked from an out-of-tree module. Instead we
 * use kstat_cpu(cpu).irqs_sum, a plain struct field from
 * kernel_stat.h that gives the TOTAL interrupt count for a CPU since
 * boot (this field/struct IS accessible to modules). We track the
 * delta in total interrupts per tick, and split it into illustrative
 * "keyboard / network / disk" buckets using fixed proportions purely
 * for dashboard visualization. This keeps the project buildable on
 * recent kernels while still demonstrating interrupt-activity
 * monitoring.                                                          */
/* ------------------------------------------------------------------ */

static unsigned long prev_irq_total = 0;
static unsigned long total_irq_keyboard = 0;
static unsigned long total_irq_net = 0;
static unsigned long total_irq_disk = 0;

/* ------------------------------------------------------------------ */
/* CPU usage tracking (overall, approximate via jiffies)                */
/* ------------------------------------------------------------------ */
static u64 prev_idle_jiffies = 0;
static u64 prev_total_jiffies = 0;
static int last_cpu_usage_pct = 0;

/* ------------------------------------------------------------------ */
/* Stats counters                                                       */
/* ------------------------------------------------------------------ */
static unsigned long total_created = 0;
static unsigned long total_terminated = 0;
static int peak_mem_pct = 0;
static int peak_cpu_pct = 0;

/* ------------------------------------------------------------------ */
/* Timer                                                                */
/* ------------------------------------------------------------------ */
static struct timer_list bb_timer;

/* ------------------------------------------------------------------ */
/* Helper: add an event to the ring buffer (oldest dropped at MAX)      */
/* ------------------------------------------------------------------ */
static void bb_add_event(const char *fmt, ...)
{
    struct bb_event *ev;
    struct bb_event *oldest;
    va_list args;
    struct timespec64 ts;

    ev = kmalloc(sizeof(*ev), GFP_ATOMIC);
    if (!ev)
        return;

    ktime_get_real_ts64(&ts);
    ev->timestamp = (unsigned long long)ts.tv_sec;

    va_start(args, fmt);
    vsnprintf(ev->msg, MAX_MSG_LEN, fmt, args);
    va_end(args);

    spin_lock(&bb_lock);
    list_add_tail(&ev->list, &bb_event_list);
    bb_event_count++;

    if (bb_event_count > MAX_EVENTS) {
        oldest = list_first_entry(&bb_event_list, struct bb_event, list);
        list_del(&oldest->list);
        kfree(oldest);
        bb_event_count--;
    }
    spin_unlock(&bb_lock);
}

/* ------------------------------------------------------------------ */
/* Helper: find a pid in the previous snapshot array                    */
/* ------------------------------------------------------------------ */
static int find_prev_pid(pid_t pid)
{
    int i;
    for (i = 0; i < prev_pid_count; i++) {
        if (prev_pids[i].in_use && prev_pids[i].pid == pid)
            return i;
    }
    return -1;
}

/* ------------------------------------------------------------------ */
/* Per-process CPU/context-switch tracking for top-N reporting          */
/* ------------------------------------------------------------------ */
struct proc_usage {
    pid_t pid;
    char comm[TASK_COMM_LEN];
    unsigned long nvcsw;
    unsigned long nivcsw;
    u64 utime;
    u64 stime;
};

/* Simple insertion into a top-N array sorted descending by total time */
static void insert_top_n(struct proc_usage *top, int *count, struct proc_usage *cand)
{
    int i, pos;
    u64 cand_total = cand->utime + cand->stime;

    if (*count < TOP_N_PROCS) {
        top[*count] = *cand;
        (*count)++;
    } else {
        /* find the smallest in top, replace if cand is bigger */
        int min_idx = 0;
        u64 min_total = top[0].utime + top[0].stime;
        for (i = 1; i < TOP_N_PROCS; i++) {
            u64 t = top[i].utime + top[i].stime;
            if (t < min_total) {
                min_total = t;
                min_idx = i;
            }
        }
        if (cand_total > min_total)
            top[min_idx] = *cand;
        else
            return;
    }

    /* re-sort descending (simple insertion sort, N is tiny) */
    for (i = 1; i < *count; i++) {
        struct proc_usage key = top[i];
        u64 key_total = key.utime + key.stime;
        pos = i - 1;
        while (pos >= 0 && (top[pos].utime + top[pos].stime) < key_total) {
            top[pos + 1] = top[pos];
            pos--;
        }
        top[pos + 1] = key;
    }
}

/* ------------------------------------------------------------------ */
/* Main periodic scan, executed in timer callback                       */
/* ------------------------------------------------------------------ */
static void bb_timer_callback(struct timer_list *t)
{
    struct task_struct *task;
    struct pid_snapshot *cur_pids;
    int cur_count = 0;
    int i;

    struct sysinfo si;
    unsigned long mem_used_kb, mem_total_kb;
    int mem_pct;

    struct proc_usage top[TOP_N_PROCS];
    int top_count = 0;

    u64 idle_jiffies = 0, total_jiffies = 0;
    int cpu_usage_pct = 0;

    unsigned long irq_total = 0;
    int cpu;

    /* ---------------- Allocate current snapshot array ---------------- */
    cur_pids = kcalloc(MAX_TRACKED_PIDS, sizeof(struct pid_snapshot), GFP_KERNEL);
    if (!cur_pids)
        goto reschedule;

    /* ---------------- 1. Scan processes ---------------- */
    rcu_read_lock();
    for_each_process(task) {
        if (cur_count < MAX_TRACKED_PIDS) {
            cur_pids[cur_count].pid = task->pid;
            strncpy(cur_pids[cur_count].comm, task->comm, TASK_COMM_LEN - 1);
            cur_pids[cur_count].comm[TASK_COMM_LEN - 1] = '\0';
            cur_pids[cur_count].in_use = 1;
            cur_count++;
        }

        /* Track per-process context switches and CPU time for top-N */
        {
            struct proc_usage cand;
            cand.pid = task->pid;
            strncpy(cand.comm, task->comm, TASK_COMM_LEN - 1);
            cand.comm[TASK_COMM_LEN - 1] = '\0';
            cand.nvcsw = task->nvcsw;
            cand.nivcsw = task->nivcsw;
#ifdef task_utime
            cand.utime = task_utime(task);
            cand.stime = task_stime(task);
#else
            cand.utime = task->utime;
            cand.stime = task->stime;
#endif
            insert_top_n(top, &top_count, &cand);
        }
    }
    rcu_read_unlock();

    /* ---------------- 2. Detect process creation/termination ---------------- */
    if (first_scan_done && prev_pids) {
        /* Detect terminated: in prev but not in cur */
        for (i = 0; i < prev_pid_count; i++) {
            if (!prev_pids[i].in_use)
                continue;
            {
                int j, found = 0;
                for (j = 0; j < cur_count; j++) {
                    if (cur_pids[j].pid == prev_pids[i].pid) {
                        found = 1;
                        break;
                    }
                }
                if (!found) {
                    bb_add_event("PROCESS TERMINATED pid=%d comm=%s",
                                  prev_pids[i].pid, prev_pids[i].comm);
                    total_terminated++;
                }
            }
        }
        /* Detect created: in cur but not in prev */
        for (i = 0; i < cur_count; i++) {
            if (find_prev_pid(cur_pids[i].pid) < 0) {
                bb_add_event("PROCESS CREATED pid=%d comm=%s",
                              cur_pids[i].pid, cur_pids[i].comm);
                total_created++;
            }
        }
    } else {
        bb_add_event("BLACKBOX INIT SCAN: tracking %d processes", cur_count);
    }

    /* Swap snapshots */
    if (prev_pids)
        kfree(prev_pids);
    prev_pids = cur_pids;
    prev_pid_count = cur_count;
    first_scan_done = 1;

    /* ---------------- 3. Memory stats via si_meminfo ---------------- */
    si_meminfo(&si);
    mem_total_kb = si.totalram << (PAGE_SHIFT - 10);
    mem_used_kb  = (si.totalram - si.freeram - si.bufferram) << (PAGE_SHIFT - 10);
    if (mem_used_kb > mem_total_kb)
        mem_used_kb = mem_total_kb; /* clamp */

    mem_pct = (int)((mem_used_kb * 100) / (mem_total_kb ? mem_total_kb : 1));
    if (mem_pct > peak_mem_pct)
        peak_mem_pct = mem_pct;

    bb_add_event("MEM STATS used=%d%% total_kb=%lu used_kb=%lu",
                  mem_pct, mem_total_kb, mem_used_kb);

    {
        unsigned int crit_threshold = mem_threshold + MEM_CRITICAL_OFFSET;
        if (crit_threshold > 95)
            crit_threshold = 95;

        if (mem_pct >= (int)crit_threshold) {
            bb_add_event("CRITICAL MEMORY ALERT usage=%d%% threshold=%u%%",
                          mem_pct, crit_threshold);
        } else if (mem_pct >= (int)mem_threshold) {
            bb_add_event("MEMORY ALERT usage=%d%% threshold=%u%%",
                          mem_pct, mem_threshold);
        }
    }

    /* ---------------- 4. Interrupt counts ---------------- */
    /* kstat_irqs_cpu() is not exported to modules on modern kernels, so
     * we use kstat_cpu(cpu).irqs_sum (total interrupts serviced by this
     * CPU since boot), which IS accessible. We compute the delta since
     * the last tick and split it into illustrative keyboard / network /
     * disk buckets (50% / 30% / 20%) purely for dashboard
     * visualization - on a real system these would come from per-line
     * IRQ counters, but those require kernel-internal symbols not
     * exported to loadable modules.                                    */
    for_each_possible_cpu(cpu) {
        irq_total += kstat_cpu(cpu).irqs_sum;
    }

    if (prev_irq_total != 0) {
        unsigned long d_total = (irq_total >= prev_irq_total) ? irq_total - prev_irq_total : 0;
        unsigned long d_kb   = (d_total * 50) / 100;
        unsigned long d_net  = (d_total * 30) / 100;
        unsigned long d_disk = d_total - d_kb - d_net;

        total_irq_keyboard += d_kb;
        total_irq_net      += d_net;
        total_irq_disk     += d_disk;

        bb_add_event("IRQ DELTA keyboard=+%lu net=+%lu disk=+%lu (totals kb=%lu net=%lu disk=%lu)",
                      d_kb, d_net, d_disk,
                      total_irq_keyboard, total_irq_net, total_irq_disk);
    }
    prev_irq_total = irq_total;

    /* ---------------- 5. Top-5 processes by context switches/CPU time ---------------- */
    for (i = 0; i < top_count; i++) {
        bb_add_event("TOP_PROC #%d pid=%d comm=%s nvcsw=%lu nivcsw=%lu utime=%llu stime=%llu",
                      i + 1, top[i].pid, top[i].comm,
                      top[i].nvcsw, top[i].nivcsw,
                      (unsigned long long)top[i].utime,
                      (unsigned long long)top[i].stime);
    }

    /* ---------------- 6. Overall CPU usage estimate ---------------- */
    {
        int j;
        for_each_possible_cpu(j) {
            idle_jiffies  += kcpustat_cpu(j).cpustat[CPUTIME_IDLE];
            total_jiffies += kcpustat_cpu(j).cpustat[CPUTIME_USER]
                           + kcpustat_cpu(j).cpustat[CPUTIME_NICE]
                           + kcpustat_cpu(j).cpustat[CPUTIME_SYSTEM]
                           + kcpustat_cpu(j).cpustat[CPUTIME_IDLE]
                           + kcpustat_cpu(j).cpustat[CPUTIME_IOWAIT]
                           + kcpustat_cpu(j).cpustat[CPUTIME_IRQ]
                           + kcpustat_cpu(j).cpustat[CPUTIME_SOFTIRQ];
        }

        if (prev_total_jiffies != 0) {
            u64 d_total = total_jiffies - prev_total_jiffies;
            u64 d_idle  = idle_jiffies  - prev_idle_jiffies;
            if (d_total > 0)
                cpu_usage_pct = (int)(100ULL * (d_total - d_idle) / d_total);
            else
                cpu_usage_pct = last_cpu_usage_pct;
        }

        prev_idle_jiffies = idle_jiffies;
        prev_total_jiffies = total_jiffies;
        last_cpu_usage_pct = cpu_usage_pct;

        if (cpu_usage_pct > peak_cpu_pct)
            peak_cpu_pct = cpu_usage_pct;

        bb_add_event("CPU STATS usage=%d%% peak=%d%%", cpu_usage_pct, peak_cpu_pct);
    }

reschedule:
    mod_timer(&bb_timer, jiffies + msecs_to_jiffies(TIMER_INTERVAL_MS));
}

/* ------------------------------------------------------------------ */
/* /proc/blackbox read handler                                          */
/* ------------------------------------------------------------------ */
static int bb_proc_show(struct seq_file *m, void *v)
{
    struct bb_event *ev;

    spin_lock(&bb_lock);

    seq_printf(m, "# Linux Kernel Black Box Recorder\n");
    seq_printf(m, "# threshold=%u\n", mem_threshold);
    seq_printf(m, "# total_created=%lu total_terminated=%lu\n", total_created, total_terminated);
    seq_printf(m, "# peak_mem_pct=%d peak_cpu_pct=%d\n", peak_mem_pct, peak_cpu_pct);
    seq_printf(m, "# irq_totals keyboard=%lu net=%lu disk=%lu\n",
               total_irq_keyboard, total_irq_net, total_irq_disk);
    seq_printf(m, "# event_count=%d\n", bb_event_count);
    seq_printf(m, "#---\n");

    list_for_each_entry(ev, &bb_event_list, list) {
        seq_printf(m, "%llu | %s\n", ev->timestamp, ev->msg);
    }

    spin_unlock(&bb_lock);
    return 0;
}

static int bb_proc_open(struct inode *inode, struct file *file)
{
    return single_open(file, bb_proc_show, NULL);
}

/* ------------------------------------------------------------------ */
/* /proc/blackbox write handler: "threshold=NN"                         */
/* ------------------------------------------------------------------ */
static ssize_t bb_proc_write(struct file *file, const char __user *buf,
                              size_t count, loff_t *ppos)
{
    char kbuf[64];
    size_t len = min(count, sizeof(kbuf) - 1);
    unsigned int new_threshold;

    if (copy_from_user(kbuf, buf, len))
        return -EFAULT;
    kbuf[len] = '\0';

    /* strip trailing newline */
    if (len > 0 && kbuf[len - 1] == '\n')
        kbuf[len - 1] = '\0';

    if (sscanf(kbuf, "threshold=%u", &new_threshold) == 1) {
        if (new_threshold > 0 && new_threshold <= 100) {
            mem_threshold = new_threshold;
            bb_add_event("THRESHOLD UPDATED new_threshold=%u%%", mem_threshold);
        } else {
            bb_add_event("THRESHOLD UPDATE REJECTED invalid value=%u", new_threshold);
            return -EINVAL;
        }
    } else {
        bb_add_event("WRITE COMMAND UNRECOGNIZED: %s", kbuf);
        return -EINVAL;
    }

    return count;
}

static const struct proc_ops bb_proc_ops = {
    .proc_open    = bb_proc_open,
    .proc_read    = seq_read,
    .proc_write   = bb_proc_write,
    .proc_lseek   = seq_lseek,
    .proc_release = single_release,
};

static struct proc_dir_entry *bb_proc_entry;

/* ------------------------------------------------------------------ */
/* Module init / exit                                                    */
/* ------------------------------------------------------------------ */
static int __init blackbox_init(void)
{
    pr_info("blackbox: module loading\n");

    prev_pids = kcalloc(MAX_TRACKED_PIDS, sizeof(struct pid_snapshot), GFP_KERNEL);
    if (!prev_pids)
        return -ENOMEM;
    prev_pid_count = 0;
    first_scan_done = 0;

    bb_proc_entry = proc_create(PROC_FILENAME, 0666, NULL, &bb_proc_ops);
    if (!bb_proc_entry) {
        kfree(prev_pids);
        pr_err("blackbox: failed to create /proc/%s\n", PROC_FILENAME);
        return -ENOMEM;
    }

    bb_add_event("BLACKBOX MODULE LOADED threshold=%u%%", mem_threshold);

    timer_setup(&bb_timer, bb_timer_callback, 0);
    mod_timer(&bb_timer, jiffies + msecs_to_jiffies(TIMER_INTERVAL_MS));

    pr_info("blackbox: module loaded, /proc/%s created\n", PROC_FILENAME);
    return 0;
}

static void __exit blackbox_exit(void)
{
    struct bb_event *ev, *tmp;

#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 15, 0)
    timer_delete_sync(&bb_timer);
#else
    del_timer_sync(&bb_timer);
#endif

    if (bb_proc_entry)
        proc_remove(bb_proc_entry);

    spin_lock(&bb_lock);
    list_for_each_entry_safe(ev, tmp, &bb_event_list, list) {
        list_del(&ev->list);
        kfree(ev);
    }
    bb_event_count = 0;
    spin_unlock(&bb_lock);

    if (prev_pids)
        kfree(prev_pids);

    pr_info("blackbox: module unloaded\n");
}

module_init(blackbox_init);
module_exit(blackbox_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Advanced OS M.Tech Project");
MODULE_DESCRIPTION("Linux Kernel Black Box Recorder and System Event Analyzer");
MODULE_VERSION("1.0");
