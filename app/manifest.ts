import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CENNO CRM',
    short_name: 'CENNO CRM',
    description: 'CRM Inteligente para Gestão de Vendas',
    start_url: '/boards',
    display: 'standalone',
    // Casado com o canvas escuro (modo padrão do app): preto profundo, emenda de 21/09/2026.
    background_color: '#0A0908',
    theme_color: '#0A0908',
    icons: [
      // SVG icons keep the repo text-only. If you need iOS splash/touch icons later,
      // add PNGs in a follow-up.
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/icons/maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}

