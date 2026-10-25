import { SITE_URL } from './site.ts';

/** Social preview: the landing page's fig. 1 poster, used as a direct capture. */
export const OG_IMAGE = {
  path: '/og.png',
  width: 1200,
  height: 630,
  alt: "The tabsh list beside a live terminal, headed 'Your shells and agents, one calm scroll.'",
} as const;

// Cloudflare serves these pages with a trailing slash (`html_handling: auto-trailing-slash`).
function canonicalPath(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** Absolute tags for a marketing page. Crawlers ignore relative `og:image` URLs. */
export function pageSeo(input: { title: string; description: string; pathname: string }) {
  const path = canonicalPath(input.pathname);
  const canonical = new URL(path, SITE_URL).href;
  const image = new URL(OG_IMAGE.path, SITE_URL).href;
  const home = path === '/';
  const website: Record<string, unknown> = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'tabsh',
    url: `${SITE_URL}/`,
  };
  if (home) website.description = input.description;

  const graph: Record<string, unknown>[] = [
    website,
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: input.title,
      description: input.description,
      isPartOf: { '@id': website['@id'] },
      primaryImageOfPage: image,
    },
  ];
  if (home) {
    graph.push({
      '@type': 'SoftwareApplication',
      name: 'tabsh',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS and Linux',
      url: canonical,
      image,
      description: input.description,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
  }

  return {
    canonical,
    image,
    imageAlt: OG_IMAGE.alt,
    imageWidth: OG_IMAGE.width,
    imageHeight: OG_IMAGE.height,
    // `<` would close the script tag if a title ever contained it.
    jsonLd: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c'),
  };
}
