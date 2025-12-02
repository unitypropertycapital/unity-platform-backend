export type PropertyType = 'house' | 'flat' | 'bungalow';

export interface SubjectProperty {
  // Original input fields
  addressLine1: string;
  addressLine2: string;
  postcode: string;
  propertyType: PropertyType;

  // Normalised address fields from Ideal Postcodes (MAT-1.2)
  line_1: string;
  line_2: string | null;
  line_3: string | null;
  post_town: string;
  normalizedAddress: string;

  // Location identifiers
  uprn: string;
  latitude: number;
  longitude: number;

  // EPC data (MAT-1.3)
  floorAreaSqm: number | null;
  floorAreaSqFt: number | null;
  habitableRooms: number | null;
  epcRating: string | null;
  epcScore: number | null;
  epcAvailable: boolean;
  epcMissingReason: string | null;
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

