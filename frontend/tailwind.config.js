/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Stitch design tokens (dark theme is the default look).
      colors: {
        primary: '#f59e0b',
        'primary-soft': '#ffc174',
        secondary: '#4fdbc8',
        'secondary-deep': '#04b4a2',
        background: '#0b1326',
        surface: '#131b2e',
        'surface-high': '#222a3d',
        'surface-highest': '#2d3449',
        ink: '#dae2fd',
        'ink-muted': '#d8c3ad',
        outline: '#a08e7a',
        error: '#ffb4ab',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
      },
    },
  },
  plugins: [],
}
