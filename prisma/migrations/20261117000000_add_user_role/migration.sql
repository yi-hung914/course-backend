-- 【新增】使用者角色：student 學生 / admin 課程管理者
-- 用 IF NOT EXISTS：後端啟動時也會自動補這個欄位，兩邊都不會重複建立而出錯
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'student';
