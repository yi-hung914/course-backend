-- DropForeignKey
ALTER TABLE "public"."Schedule" DROP CONSTRAINT "Schedule_sectionId_fkey";

-- AlterTable
ALTER TABLE "public"."Schedule" ADD COLUMN     "location" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Schedule" ADD CONSTRAINT "Schedule_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "public"."Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
