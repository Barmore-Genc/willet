#!/usr/bin/env node
import { buildProgram } from "./index.js";

buildProgram().parseAsync(process.argv);
