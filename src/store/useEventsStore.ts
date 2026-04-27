import { create } from 'zustand';
import { mockEvents } from '@/data/mockEvents';

export const useEventsStore = create(() => ({ events: mockEvents }));
