-- PLAN.md "Directory order-eligibility gate"

ALTER TABLE "ProfessionalServiceOffering" ADD COLUMN "acceptingOrders" BOOLEAN NOT NULL DEFAULT true;
