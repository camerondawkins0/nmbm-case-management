import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./theme.css";
import { applyTheme, storedTheme } from "./lib/theme.js";

// Before the first paint, so the page never flashes the wrong theme.
applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
