
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        goout: {
          green: '#EF4F5F',
          dark: '#1C1C1C',
          accent: '#FC8019',
          mint: '#FEE2E2',
          violet: '#FB7185',
          sky: '#FDBA74',
          neon: '#F43F5E',
          fuchsia: '#EA580C'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        'dock': '0 18px 50px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.45) inset',
        'dock-dark': '0 22px 56px -14px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.1) inset',
        'glow-sm': '0 0 36px rgba(239, 79, 95, 0.16), 0 0 72px rgba(252, 128, 25, 0.12)',
        'card-deep': '0 24px 64px -16px rgba(2, 6, 23, 0.2), 0 0 0 1px rgba(239, 79, 95, 0.1)'
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
        'scale-in': 'scaleIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'neon-pan': 'neonPan 8s linear infinite'
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
            boxShadow: '0 0 20px rgba(239, 79, 95, 0.22), 0 0 40px rgba(252, 128, 25, 0.12)'
          },
          '50%': {
            boxShadow: '0 0 28px rgba(239, 79, 95, 0.34), 0 0 56px rgba(252, 128, 25, 0.18)'
          }
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(239, 79, 95, 0.3)' },
          '50%': { borderColor: 'rgba(252, 128, 25, 0.5)' }
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        neonPan: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' }
        }
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    }
  },
  plugins: []
};
