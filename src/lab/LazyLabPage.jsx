import { lazy } from "react";

// The lab page is only downloaded when someone visits /lab
const LazyLabPage = lazy(() => import("./LabPage.jsx"));
export default LazyLabPage;
