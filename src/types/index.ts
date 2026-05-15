export interface SearchParams {
  keyword: string;
  maxResults: number;
  sortMode?: string;
}

export interface SearchItem {
  rank: number;
  keyword: string;
  title: string;
  price?: string;
  salesText?: string;
  shopName?: string;
  url?: string;
  imageUrl?: string;
  collectedAt: string;
}

export interface SearchSnapshot {
  keyword: string;
  timestamp: string;
  items: SearchItem[];
  searchSuggestions?: string[];
  imageSearchHotTerms?: string[];
  source: "live" | "history";
  note?: string;
}

export interface ProductInput {
  productName: string;
  category: string;
  brand?: string;
  coreFeatures: string[];
  targetPeople?: string[];
  usageScenarios?: string[];
  specs?: string[];
  bannedTerms?: string[];
  preferredTerms?: string[];
  imageSearchHotTerms?: string[];
  styleTone?: "search" | "conversion" | "balanced" | "compliance";
}

export interface AnalysisResult {
  keyword: string;
  analyzedAt: string;
  itemCount: number;
  highFreqTerms: string[];
  suggestionTerms: string[];
  promotionTerms: string[];
  titlePatterns: string[];
  classifiedTerms: Record<string, string[]>;
  priceBands: Array<{ range: string; count: number }>;
  sourceSnapshot: string;
}

export interface GeneratedTitle {
  title: string;
  type: "search" | "conversion" | "balanced" | "compliance";
  score: number;
  usedTerms: string[];
  riskFlags: string[];
  explanation?: string;
}

export interface GenerationResult {
  keyword: string;
  generatedAt: string;
  recommendedTitles: GeneratedTitle[];
  warnings: string[];
  analysisFile: string;
  productFile: string;
}
