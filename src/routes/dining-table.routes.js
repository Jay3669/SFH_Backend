import { Router } from "express";
import {
    createDiningTable,
    listDiningTables,
    mergeDiningTables,
    moveDiningTable,
    updateDiningTableStatus,
} from "../controllers/dining-table.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/", listDiningTables);
router.post("/", createDiningTable);
router.post("/:tableName/move", moveDiningTable);
router.post("/:tableName/merge", mergeDiningTables);
router.patch("/:tableName/status", updateDiningTableStatus);

export default router;
