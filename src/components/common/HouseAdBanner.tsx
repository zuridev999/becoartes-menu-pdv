import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';

type HouseAdCampaign = {
  id: string;
  title: string;
  message: string;
  href: string;
  action: string;
};

const DEFAULT_CAMPAIGNS: HouseAdCampaign[] = [
  {
    id: 'becoartes-site',
    title: 'Becoartes',
    message: 'Arte, cultura e gastronomia no Beco do Batman.',
    href: 'https://becoartes.com',
    action: 'Conhecer',
  },
];

const ROTATION_INTERVAL_MS = 12_000;

function parseCampaigns(rawValue: string | undefined): HouseAdCampaign[] {
  if (!rawValue) return DEFAULT_CAMPAIGNS;

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return DEFAULT_CAMPAIGNS;

    const campaigns = parsed.filter((item): item is HouseAdCampaign => (
      typeof item?.id === 'string'
      && typeof item?.title === 'string'
      && typeof item?.message === 'string'
      && typeof item?.href === 'string'
      && typeof item?.action === 'string'
      && /^https?:\/\//i.test(item.href)
    ));

    return campaigns.length > 0 ? campaigns : DEFAULT_CAMPAIGNS;
  } catch {
    return DEFAULT_CAMPAIGNS;
  }
}

export function HouseAdBanner() {
  const enabled = import.meta.env.VITE_HOUSE_AD_ENABLED !== 'false';
  const campaigns = useMemo(
    () => parseCampaigns(import.meta.env.VITE_HOUSE_ADS_JSON),
    [],
  );
  const [campaignIndex, setCampaignIndex] = useState(0);

  useEffect(() => {
    if (!enabled || campaigns.length < 2) return undefined;

    const interval = window.setInterval(() => {
      setCampaignIndex((current) => (current + 1) % campaigns.length);
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [campaigns.length, enabled]);

  if (!enabled) return null;

  const campaign = campaigns[campaignIndex] || campaigns[0];

  return (
    <aside
      aria-label="Publicidade Becoartes"
      className="sticky top-0 z-[65] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-2 text-white shadow-lg backdrop-blur-xl"
    >
      <a
        href={campaign.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto flex min-h-11 w-full max-w-6xl items-center gap-3 rounded-md px-2 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-300 text-zinc-950">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase text-amber-300">Publicidade</span>
          <span className="flex min-w-0 items-baseline gap-2">
            <strong className="shrink-0 text-sm font-black">{campaign.title}</strong>
            <span className="truncate text-xs font-semibold text-zinc-300">{campaign.message}</span>
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-black uppercase text-amber-300 sm:flex">
          {campaign.action}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </a>
    </aside>
  );
}
