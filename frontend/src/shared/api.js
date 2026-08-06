import axios from "axios";

const STORAGE_KEY = "aproServerUrl";
const DEFAULT_SERVER_URL = "http://localhost:3000";
const ADMIN_DEVICE_KEY = "mailcatchAdminDeviceToken";

function getAdminDeviceToken() {
  let token = localStorage.getItem(ADMIN_DEVICE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(ADMIN_DEVICE_KEY, token);
  }
  return token;
}

export function normalizeServerUrl(value) {
  let url = String(value || "").trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

export function getServerUrl() {
  return normalizeServerUrl(localStorage.getItem(STORAGE_KEY) || DEFAULT_SERVER_URL);
}

export function setServerUrl(value) {
  const url = normalizeServerUrl(value);
  localStorage.setItem(STORAGE_KEY, url);
  api.defaults.baseURL = url;
  return url;
}

export function apiUrl(path) {
  return `${getServerUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

const api = axios.create({
  baseURL: getServerUrl(),
  timeout: 15000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["X-Admin-Device-Token"] = getAdminDeviceToken();
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) window.dispatchEvent(new CustomEvent("mailcatch:api-unavailable"));
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.assign("/");
    }
    return Promise.reject(error);
  }
);

export default api;
