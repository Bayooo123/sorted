export type AuthStackParamList = {
  PhoneSignIn: undefined;
  OtpVerify: { phone: string; requestId: string };
  AccountType: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Browse: undefined;
  Ledger: undefined;
  Profile: undefined;
};

export type GigStackParamList = {
  HomeFeed: undefined;
  PostGig: undefined;
  FundEscrow: { gigId: string };
  ReviewSignOff: { gigId: string };
};

export type BrowseStackParamList = {
  BrowseMarket: undefined;
  ClaimWork: { gigId: string };
};
