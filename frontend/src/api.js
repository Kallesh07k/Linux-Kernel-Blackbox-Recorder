import axios from 'axios'

// Backend Flask API base URL.
// If you access the dashboard from a different machine/VM IP,
// change this to that machine's address, e.g. 'http://192.168.1.50:5000'
export const API_BASE = 'http://localhost:5000'

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
})

export default api
