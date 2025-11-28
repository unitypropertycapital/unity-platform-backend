export interface MarketValue {
  low: number;
  high: number;
  central: number;
}

export interface OfferRange {
  low: number;
  high: number;
}

export type OfferType = 'FAST_TRACK' | 'FLEXIBLE';

export interface Offers {
  fastTrack: OfferRange;
  flexible: OfferRange;
  selectedOfferType: OfferType;
}

export type ConfidenceLabel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ComparableProperty {
  source: 'LR' | 'PD';
  price: number;
  date: string;
  distanceMiles: number;
  floorAreaSqm: number | null;
  psqm: number | null;
  used: boolean;
}

export interface ValuationSuccessResponse {
  deskReview: false;
  address: string;
  marketValue: MarketValue;
  offers: Offers;
  confidence: ConfidenceLabel;
  confidenceScore: number;
  maxRadiusUsedMiles: number;
  comparables: ComparableProperty[];
  streetViewUrl: string | null;
  timestamp: string;
}

export interface ValuationDeskReviewResponse {
  deskReview: true;
  reason: string;
  message: string;
}

export type ValuationResponse = ValuationSuccessResponse | ValuationDeskReviewResponse;

