/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // ClassQuest design-system tokens. Keep these aligned with the style guide.
      colors: {
        primary: '#f0a63c',
        'primary-soft': '#ffc174',
        secondary: '#43d9c4',
        'secondary-deep': '#16ae9d',
        world: '#8d6bff',
        background: '#0a0e1a',
        'background-raised': '#0d1220',
        surface: '#131b2e',
        'surface-high': '#1a2338',
        'surface-highest': '#232f4a',
        ink: '#e9ecf7',
        'ink-soft': '#dbe0f5',
        'ink-muted': '#8f9ac0',
        outline: '#6f7aa0',
        error: '#ff8f86',
      },
      fontFamily: {
        sans: ['Sora', 'system-ui', 'sans-serif'],
        hud: ['Silkscreen', 'ui-monospace', 'monospace'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
      },
    },
  },
  plugins: [],
}
