-- 【新增】課程加上「學期」欄位，讓系統可以放多個學期的課程
--   原本的課程都是 1141 學期，所以預設值設成 '1141'
--   課號(code) 原本整個資料表不能重複，改成「課號 + 學期」不能重複

-- DropIndex
DROP INDEX "public"."Course_code_key";

-- AlterTable
ALTER TABLE "public"."Course" ADD COLUMN     "semester" TEXT NOT NULL DEFAULT '1141';

-- CreateIndex
CREATE INDEX "Course_semester_idx" ON "public"."Course"("semester");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_semester_key" ON "public"."Course"("code", "semester");
