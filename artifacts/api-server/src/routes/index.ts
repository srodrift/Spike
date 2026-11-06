import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spikeRouter from "./spike";

const router: IRouter = Router();

router.use(healthRouter);
router.use(spikeRouter);

export default router;
