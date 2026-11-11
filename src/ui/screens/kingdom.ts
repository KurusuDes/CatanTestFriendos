import { storage } from '@ui/dom';
import { myKingdom, patternFlag, type MyKingdom } from '@ui/flag/flag';

export const NAME_KEY = 'katanittes.name';

/** the kingdom this device remembers (name, castle colour, banner), or a red default */
export const myOrDefaultKingdom = (): MyKingdom => myKingdom() || { name: (storage(NAME_KEY) as string | null) || '', color: '#e53935', flag: patternFlag('#e53935', 1) };
