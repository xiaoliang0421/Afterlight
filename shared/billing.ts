import { z } from "zod";

export const generationModels = {
  text: "minimax/h3-max-turbo/text-to-video",
  reference: "minimax/h3-max/reference-to-video",
} as const;
export type GenerationMode = keyof typeof generationModels;
export const checkoutInput = z.object({
  packageId: z.string().min(1).max(80),
  idempotencyKey: z.string().uuid(),
  termsVersion: z.string().min(1).max(80),
  purchaseAccepted: z.literal(true),
});
export interface BillingPackage {
  id: string;
  name: string;
  points: number;
  amountCents: number;
  currency: string;
}
export interface BillingOrder {
  id: string;
  points: number;
  amountCents: number;
  currency: string;
  status: string;
  grantedPoints: number;
  totalPaidCents: number | null;
  taxCents: number | null;
  createdAt: number;
  environment: "sandbox" | "production";
}
export interface BillingOverview {
  requests: {
    id: string;
    orderId: string;
    reason: string;
    status: string;
    response: string;
    createdAt: number;
  }[];
  enabled: boolean;
  environment: "sandbox" | "production";
  textEnabled: boolean;
  textPoints: number;
  referenceEnabled: boolean;
  referencePoints: number;
  wallet: {
    available: number;
    reserved: number;
    spent: number;
    debt: number;
    held: boolean;
  };
  packages: BillingPackage[];
  orders: BillingOrder[];
}
