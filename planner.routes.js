import { Router } from "express";
import { addPlannerItem, savePlanner, getPlanner } from "./planner.controller.js";

const router = Router();

// 不用 requireAuth，直接交給 controller 用 x-user-id
router.post("/", addPlannerItem);

// 【新增】讀取 / 整份儲存使用者的擬排課表
//   這兩條會比 server.js 下面的 app.get("/api/planner", requireAuth, ...) 先被比對到
router.get("/", getPlanner);
router.put("/", savePlanner);

export default router;
