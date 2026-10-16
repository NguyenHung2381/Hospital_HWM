import type { RouteInstructionType } from '@hwn/map-core';
import type { IconName } from './Icon';

export const INSTRUCTION_ICON: Record<RouteInstructionType, IconName> = {
  start: 'start',
  straight: 'straight',
  'turn-left': 'left',
  'turn-right': 'right',
  'take-elevator': 'elevator',
  'take-stairs': 'stairs',
  'take-escalator': 'escalator',
  'enter-room': 'door',
  arrive: 'flag',
};
