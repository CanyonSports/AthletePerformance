// next.config.mjs
export default {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    if (dev) {
      // Avoid filesystem pack cache to stop ENOENT rename errors
      config.cache = { type: "memory" };
    }
    return config;
  },
};
