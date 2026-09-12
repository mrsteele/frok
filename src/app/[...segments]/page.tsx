import { notFound } from 'next/navigation';
import { studioRoute } from '@/lib/navigation';

// The persistent layout owns one Studio. Pages only validate route addresses.
export default async function Page({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  if (!studioRoute(`/${segments.map(encodeURIComponent).join('/')}`)) notFound();
  return null;
}
