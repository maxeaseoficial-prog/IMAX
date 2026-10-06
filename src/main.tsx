import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import App from "./App";
import BrowserWorkspace from "./BrowserWorkspace";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.imx ? <App /> : <BrowserWorkspace />}
  </React.StrictMode>
);

