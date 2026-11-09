export const emotions = ["neutral", "warm", "empathetic", "cheerful", "thoughtful"] as const;
export type Emotion = (typeof emotions)[number];
export interface CocktailCard {
  id: string;
  name: string;
  phrase: string;
  description: string;
  imageUrl: string;
}
export interface ChatResponse {
  message: string;
  emotion: Emotion;
  cocktailCard: CocktailCard | null;
}
