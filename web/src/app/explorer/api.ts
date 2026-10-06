// The explorer's side of the file API: the listing of a tab's project.
import type { Fetcher } from '../files/api.ts';
import type { Listing } from './listing.ts';

export async function fetchTree(f: Fetcher, session: string): Promise<Listing> {
  const res = await f(`/api/files/tree?session=${encodeURIComponent(session)}`);
  if (!res.ok) throw new Error(`GET /api/files/tree: ${res.status}`);
  return res.json();
}
