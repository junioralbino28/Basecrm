/** @type {import('tailwindcss').Config} */
const config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./context/**/*.{js,ts,jsx,tsx}",
        "./features/**/*.{js,ts,jsx,tsx}",
        "./hooks/**/*.{js,ts,jsx,tsx}",
        "./lib/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}",
    ],
    // Note: In Tailwind v4, most configuration is done in CSS with @theme
    // This file is kept for content scanning and legacy compatibility
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-jakarta)', 'Plus Jakarta Sans', 'sans-serif'],
                display: ['var(--font-fraunces)', 'Fraunces', 'serif'],
                serif: ['var(--font-fraunces)', 'Fraunces', 'serif'],
            },
            colors: {
                dark: {
                    bg: '#020617',
                    card: '#0f172a',
                    border: '#1e293b',
                    hover: '#334155',
                },
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
            }
        },
    },
    plugins: [],
}

export default config
