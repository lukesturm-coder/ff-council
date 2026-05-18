// Shared types for the global Cmd-K search index. Server-side data loaders
// (in Header.tsx) build these shapes, and the client-side SearchBar fuzzy-
// matches against them in-memory. Kept tiny on purpose — the index ships
// inline with every page render, so payload size matters.

export type SearchPlayer = {
  id: number;
  name: string;
  team: string;
  position: string;
};

export type SearchVerdict = {
  id: string;
  scenarioType: "draft" | "start_sit";
  snippet: string;
};

export type SearchTrade = {
  id: string;
  sideASummary: string;
  sideBSummary: string;
};

export type SearchIndex = {
  players: SearchPlayer[];
  verdicts: SearchVerdict[];
  trades: SearchTrade[];
};
