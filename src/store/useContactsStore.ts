import { create } from 'zustand';
import { mockContacts } from '@/data/mockContacts';

export const useContactsStore = create(() => ({ contacts: mockContacts }));
