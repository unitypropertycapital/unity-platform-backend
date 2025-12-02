// Ideal Postcodes types
export interface IdealPostcodesAddress {
  line_1: string;
  line_2: string;
  line_3: string;
  post_town: string;
  postcode: string;
  uprn: string;
  latitude: number;
  longitude: number;
  building_name: string;
  building_number: string;
  thoroughfare: string;
  country: string;
}

export interface IdealPostcodesResponse {
  code: number;
  message: string;
  result: IdealPostcodesAddress[];
}

export interface IdealPostcodesUPRNResponse {
  code: number;
  message: string;
  result: IdealPostcodesAddress;
}

// PropertyData types
export interface PropertyDataEPC {
  uprn: string;
  address: string;
  postcode: string;
  property_type: string;
  built_form: string;
  total_floor_area: number;
  current_energy_rating: string;
  potential_energy_rating: string;
  inspection_date: string;
}

export interface PropertyDataEPCResponse {
  status: string;
  data: PropertyDataEPC | null;
}

export interface PropertyDataSale {
  address: string;
  postcode: string;
  price: number;
  date: string;
  property_type: string;
  new_build: boolean;
  tenure: string;
  latitude: number;
  longitude: number;
}

export interface PropertyDataSalesResponse {
  status: string;
  data: PropertyDataSale[];
}

// Google Street View types
export interface StreetViewMetadata {
  status:
    | 'OK'
    | 'ZERO_RESULTS'
    | 'NOT_FOUND'
    | 'OVER_QUERY_LIMIT'
    | 'REQUEST_DENIED'
    | 'INVALID_REQUEST'
    | 'UNKNOWN_ERROR';
  pano_id?: string;
  location?: {
    lat: number;
    lng: number;
  };
}

export interface StreetViewResult {
  url: string;
  available: boolean;
}

// Health check types
export interface ServiceHealth {
  service: string;
  status: 'ok' | 'error';
  latencyMs: number;
  message?: string;
}

// Legacy array-based response (internal use)
export interface HealthCheckResponseLegacy {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceHealth[];
}

// MAT-1.1 compliant response format
export type ServiceStatus = 'ok' | 'error';

export interface HealthCheckServicesMap {
  ideal_postcodes: ServiceStatus;
  property_data: ServiceStatus;
  epc: ServiceStatus;
  google_street_view: ServiceStatus;
  supabase: ServiceStatus;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  services: HealthCheckServicesMap;
}

// Generic health check result
export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

