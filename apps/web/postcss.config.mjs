/**
 * PostCSS config for Tailwind v4.
 *
 * Tailwind v4 ships its own PostCSS plugin (`@tailwindcss/postcss`) that
 * replaces the v3-era `tailwindcss` + `autoprefixer` pair. No additional
 * plugins are needed — prefixing is handled inside the plugin itself.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
