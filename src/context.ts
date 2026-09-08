import { createContext, useContext } from "react";
import type { AppConfig, Credits, Story, User } from "../shared/domain";
export interface Bootstrap {
  config: AppConfig;
  user: User | null;
  credits: Credits | null;
  wallet: {
    available: number;
    reserved: number;
    spent: number;
    held: boolean;
  } | null;
  stories: Story[];
  favorites: string[];
  notifications: {
    id: string;
    message: string;
    storyId: string;
    taskId: string;
    readAt: number | null;
  }[];
}
export interface AppState {
  boot: Bootstrap;
  refresh: () => Promise<void>;
  requireLogin: () => boolean;
  toast: (message: string) => void;
}
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const c = useContext(AppContext);
  if (!c) throw new Error("App context missing");
  return c;
}
