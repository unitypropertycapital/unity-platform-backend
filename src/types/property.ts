export type PropertyType = 'house' | 'flat' | 'bungalow';

export interface SubjectProperty {
  addressLine1: string;
  addressLine2: string;
  postcode: string;
  normalizedAddress: string;
  uprn: string;
  latitude: number;
  longitude: number;
  floorAreaSqm: number | null;
  propertyType: PropertyType;
  epcRating: string | null;
}

export type ResolvePropertyResult =
  | {
      success: true;
      property: SubjectProperty;
    }
  | {
      success: false;
      error: string;
      missingFields: string[];
    };

