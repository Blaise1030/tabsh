// Temporary: the Solid root while the views are still VanJS.
import { App } from './app.ts';

export function Shell() {
  return <>{App()}</>;
}
