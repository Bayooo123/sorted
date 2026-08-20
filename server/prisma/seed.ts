/**
 * Taxonomy seed data (HANDOFF.md §3.2 TAXONOMY seam): categories are rows,
 * not hardcoded enums. This is a starting set, not a fixed list — adding a
 * category later is `prisma studio` or another seed run, never a deploy.
 *
 * Idempotent: safe to re-run (upsert on `key`).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAINS = [
  { key: 'physical', label: 'Physical' },
  { key: 'digital', label: 'Digital' },
];

const SUBMARKETS: { key: string; label: string; domainKey: string }[] = [
  // Physical
  { key: 'plumbing', label: 'Plumbing', domainKey: 'physical' },
  { key: 'electrical', label: 'Electrical', domainKey: 'physical' },
  { key: 'cleaning', label: 'Cleaning', domainKey: 'physical' },
  { key: 'carpentry', label: 'Carpentry', domainKey: 'physical' },
  { key: 'painting', label: 'Painting', domainKey: 'physical' },
  { key: 'appliance-repair', label: 'Appliance Repair', domainKey: 'physical' },
  { key: 'moving-logistics', label: 'Moving & Logistics', domainKey: 'physical' },
  { key: 'gardening-landscaping', label: 'Gardening & Landscaping', domainKey: 'physical' },
  { key: 'event-setup', label: 'Event Setup', domainKey: 'physical' },
  { key: 'in-person-tutoring', label: 'In-Person Tutoring', domainKey: 'physical' },
  // Digital
  { key: 'web-development', label: 'Web Development', domainKey: 'digital' },
  { key: 'graphic-design', label: 'Graphic Design', domainKey: 'digital' },
  { key: 'content-writing', label: 'Content Writing', domainKey: 'digital' },
  { key: 'video-editing', label: 'Video Editing', domainKey: 'digital' },
  { key: 'social-media-management', label: 'Social Media Management', domainKey: 'digital' },
  { key: 'virtual-assistant', label: 'Virtual Assistant', domainKey: 'digital' },
  { key: 'data-entry', label: 'Data Entry', domainKey: 'digital' },
  { key: 'online-tutoring', label: 'Online Tutoring', domainKey: 'digital' },
  { key: 'voice-over', label: 'Voice Over', domainKey: 'digital' },
  { key: 'transcription', label: 'Transcription', domainKey: 'digital' },
];

const PAYER_TYPES = [
  { key: 'individual', label: 'Individual' },
  { key: 'corporate', label: 'Corporate' },
  { key: 'ngo', label: 'NGO' },
  { key: 'government', label: 'Government' },
];

async function main() {
  const domainIdByKey = new Map<string, string>();

  for (const d of DOMAINS) {
    const row = await prisma.domain.upsert({
      where: { key: d.key },
      create: d,
      update: { label: d.label },
    });
    domainIdByKey.set(d.key, row.id);
  }

  for (const s of SUBMARKETS) {
    const domainId = domainIdByKey.get(s.domainKey);
    await prisma.submarket.upsert({
      where: { key: s.key },
      create: { key: s.key, label: s.label, domainId },
      update: { label: s.label, domainId },
    });
  }

  for (const p of PAYER_TYPES) {
    await prisma.clientTypeRef.upsert({
      where: { key: p.key },
      create: p,
      update: { label: p.label },
    });
  }

  console.log(`Seeded ${DOMAINS.length} domains, ${SUBMARKETS.length} submarkets, ${PAYER_TYPES.length} client types.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
