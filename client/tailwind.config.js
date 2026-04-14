
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        goout: {
          green: '#10B981',
          dark: '#0F172A',
          accent: '#34D399',
          mint: '#D1FAE5',
          violet: '#8B5CF6',
          sky: '#38BDF8'
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif']
      },
      animation: {
        'fade-in': 'fadeIn 0.45s ease-out forwards',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'float-slow': 'floatY 7s ease-in-out infinite',
        'float-delayed': 'floatY 9s ease-in-out infinite 1.2s',
        'shimmer': 'shimmer 2.4s ease-in-out infinite',
        'gradient-x': 'gradientShift 8s ease infinite',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
        'spin-slow': 'spin 14s linear infinite',
        'glow-pulse': 'glowPulse 2.8s ease-in-out infinite',
        'border-glow': 'borderGlow 4s ease-in-out infinite',
        'scale-in': 'scaleIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        floatY: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-12px) scale(1.02)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.04)' }
        },
        glowPulse: {
          '0%, 100%': {
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.2), 0 0 40px rgba(56, 189, 248, 0.08)'
          },
          '50%': {
            boxShadow: '0 0 28px rgba(16, 185, 129, 0.35), 0 0 56px rgba(56, 189, 248, 0.14)'
          }
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(16, 185, 129, 0.25)' },
          '50%': { borderColor: 'rgba(56, 189, 248, 0.45)' }
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    }
  },
  plugins: []
};
