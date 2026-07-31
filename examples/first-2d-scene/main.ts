import { PACKAGE_NAME as sceneName } from "four/scene";
import { PACKAGE_NAME as mathName } from "four/math";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.textContent = `${sceneName} + ${mathName}`;
