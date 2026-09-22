export type AuthStackParamList = {
  SignIn: undefined;
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
  Directory: undefined;
  /** hireProfessionalId/Name/hireSubmarketKey set when arriving from Directory's "Hire" action — see PLAN.md "Professional directory". */
  PostGig: { hireProfessionalId?: string; hireProfessionalName?: string; hireSubmarketKey?: string } | undefined;
  FundEscrow: { gigId: string };
  ReviewSignOff: { gigId: string };
};

export type BrowseStackParamList = {
  BrowseMarket: undefined;
  ClaimWork: { gigId: string };
};
