obj-m += blackbox.o

KDIR := /lib/modules/$(shell uname -r)/build
PWD  := $(shell pwd)

all:
	$(MAKE) -C $(KDIR) M=$(PWD) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean

load:
	sudo insmod blackbox.ko

unload:
	sudo rmmod blackbox

reload: unload all load

.PHONY: all clean load unload reload
