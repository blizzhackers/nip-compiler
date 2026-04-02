import LLD from '../../compiler/nip/LLD.nip?raw';
import classic from '../../compiler/nip/classic.nip?raw';
import follower from '../../compiler/nip/follower.nip?raw';
import gold from '../../compiler/nip/gold.nip?raw';
import keyorg from '../../compiler/nip/keyorg.nip?raw';
import kolton from '../../compiler/nip/kolton.nip?raw';
import pots from '../../compiler/nip/pots.nip?raw';
import shopbot from '../../compiler/nip/shopbot.nip?raw';
import showcase from '../../compiler/nip/showcase.jip?raw';

export interface NipFileEntry {
  name: string;
  content: string;
  enabled: boolean;
  builtin: boolean;
}

export function getDefaultFiles(): NipFileEntry[] {
  return [
    { name: 'kolton.nip', content: kolton, enabled: true, builtin: true },
    { name: 'classic.nip', content: classic, enabled: false, builtin: true },
    { name: 'LLD.nip', content: LLD, enabled: false, builtin: true },
    { name: 'follower.nip', content: follower, enabled: false, builtin: true },
    { name: 'gold.nip', content: gold, enabled: false, builtin: true },
    { name: 'keyorg.nip', content: keyorg, enabled: false, builtin: true },
    { name: 'pots.nip', content: pots, enabled: false, builtin: true },
    { name: 'shopbot.nip', content: shopbot, enabled: false, builtin: true },
    { name: 'showcase.jip', content: showcase, enabled: false, builtin: true },
  ];
}
