# Manufacturing profit planning with PySCIPOpt

Act as the COO of a fictional industrial-pump manufacturer: choose annual teams, prices, production, shipments, R&D allocations, and four investments across three years. One editable YAML scenario becomes a bounded mixed-integer nonlinear optimization model. An independent numerical verifier checks the incumbent before the application prints decision tables and saves cash, staffing, market, and factory reports.

All figures are **synthetic company assumptions**, not estimates of real wages, tariffs, pump prices, productivity, or market demand. The objective is cumulative three-year **net cash**, despite the broader “profit planning” title.

## Prerequisites

- Git and Docker with Docker Compose v2; Docker Desktop works on macOS and Windows.
- Internet access for the initial image and dependency download.
- A terminal and a text editor. No host Python installation is needed for the container workflow.

The image pins Python 3.12.14, uv 0.12.13, and locked dependencies. The application uses PySCIPOpt 6.2.1 with bundled SCIP 10.0.2, NumPy 2.5.3, PyYAML 6.0.3, Matplotlib 3.11.1, and structlog 26.1.0. Dependency versions and development tools are in `pyproject.toml` and `uv.lock`.

## Run it

```bash
git clone https://github.com/utr1903/tech-with-ugur-labs.git
cd tech-with-ugur-labs/labs/lab-manufacturing-profit-pyscipopt
docker compose up -d --build
docker compose exec lab sh
python -m app
```

The last command runs **inside the container shell**, from `/lab`. The default input is `scenario.yaml`; reports are written to `output/`. The container stays alive between commands.

Edit `scenario.yaml` or files under `src/app/` using your host editor, then run `python -m app` again in the container. The lab is bind-mounted at `/lab`, so these edits apply without rebuilding. Dependencies live separately in `/opt/venv`. Changes to dependencies, the lockfile, or Dockerfile require exiting the shell and running `docker compose up -d --build` again.

Optional arguments, inside the shell:

```bash
python -m app --help
python -m app --scenario scenario.yaml --output output --time-limit 120 --gap 0.01
```

Omitting `--time-limit` and `--gap` preserves the YAML settings; the default scenario requests 120 seconds and a 0.01 relative gap. Each invocation solves exactly one scenario. To retain different runs, choose a different `--output` directory for each.

`LOG_LEVEL` controls JSON logs and defaults to `info`. `.env.example` also documents the container's `UV_PROJECT_ENVIRONMENT=/opt/venv` and `PYTHONPATH=/lab/src`. These defaults support the mounted edit cycle. Logs and reader-facing tables share stdout: JSON lines describe operations; labelled text tables describe decisions.

## What you should see

The report begins with SCIP's actual termination status, elapsed solve time, objective bound, relative gap, node count, and variable/constraint counts **before presolve**. Decision tables follow only after independent verification.

- `optimal` means SCIP reported optimality, within numerical tolerances.
- `feasible_incumbent` means a verified feasible plan exists but optimality was not established. This includes `timelimit` and `gaplimit`; reaching the configured 1% gap is not a claim of global optimality.
- `no_incumbent` means there is no decision plan to report. The status remains visible; previous output files are preserved.

The bound and gap are SCIP statistics for its scalar cash auxiliary objective. The report shows that incumbent objective **separately** from independently recomputed cumulative cash. A limited incumbent can leave both the cash inequality and electricity epigraph slack, so those values need not match. This slack must still stay within the independently verified finite auxiliary bounds. Do not recalculate or reinterpret SCIP's reported relative gap using the recomputed cash.

| Artifact | Contents |
|---|---|
| `solution.json` | Schema version; exact input-byte SHA-256 and path; separate CLI overrides; solver settings/status/SCIP version/size/timing/bound/gap; axes; every decision array including auxiliaries; verifier tolerances; exact annual and cumulative cash and regional cost |
| `annual_cash.csv` | Annual revenue, salaries, materials, electricity, both overheads, shipping, investment, net cash; all MUSD |
| `budget_utilization.csv` | Every region and central authorization: annual limit, use, remaining amount, fraction used; zero use with zero allowance is shown as zero |
| `investments.csv` | Start, delayed availability, and capex per investment/year |
| `headcount.csv` | People and salary cost per region/team/year |
| `rd_and_knowledge.csv` | R&D capability, process/development/maintenance allocations, and shared knowledge/activity states |
| `market_plan.csv` | Sales share, headcount-equivalent effort, price in USD/unit, volume, and revenue in MUSD |
| `factory_plan.csv` | Production per product plus open state and factory totals for energy, exact bill, auxiliary bill, material, shipping, overhead |
| `shipments.csv` | Every factory-to-market/product/year shipment and its shipping cost |
| `cash_composition.png` | Positive revenue, negative cost composition, and annual net cash |
| `investment_production.png` | Investment starts and next-year availability above factory/product production |

Factory totals repeat on each product row of `factory_plan.csv`; shared process savings, development stock, and activity repeat across regions in `rd_and_knowledge.csv`. **Do not sum these repeated columns.** Annual cash provides the additive company totals. Money is in millions of USD except the explicitly converted `price_usd_per_unit` CSV column: 1 MUSD = 1,000,000 USD. JSON decision prices retain MUSD/unit.

All artifacts are staged before publication, then each file is replaced atomically. A failed verification or a staging failure leaves existing artifacts unchanged. The group of files is not a transactional filesystem snapshot: interruption during the final replacements can leave files from different runs. Avoid simultaneous writers to the same output directory.

Exit codes are `0` for a verified report, `2` for scenario validation, `3` for no incumbent/infeasibility, `4` for failed independent verification, and `1` for another application-domain error. Invalid CLI syntax also uses argparse's code `2`.

## How it works

`scenario/` safely loads named YAML mappings into immutable, axis-labelled NumPy arrays, validates units/shape/physical assumptions, and derives finite bounds. `model/` creates PySCIPOpt Matrix API variables, adds the equations below, and extracts an incumbent only when one exists. `verification/` independently recomputes the physical and cash relationships using numerical arithmetic; it imports neither model equations nor model-bound helpers. `reporting/` shares frozen table rows between CSV and console output and creates standalone PNG figures. `commands/run.py` coordinates one run; `__main__.py` handles arguments and exit codes.

| Axis | Ordered labels |
|---|---|
| Years `t` | `year_1`, `year_2`, `year_3` (displayed as 1, 2, 3) |
| Regions `r` / markets `m` | `us`, `india`, `germany`, `china` |
| Factories `f` | `germany`, `china` |
| Products `p` | `standard`, `high_performance` |
| Teams `k` | `rd`, `manufacturing`, `sales`, `support` |
| R&D regions | `us`, `india` |
| R&D uses `u` | `process`, `development`, `maintenance` |
| Investments `i` | `us_rd_upgrade`, `india_rd_upgrade`, `germany_capacity_upgrade`, `china_factory` |

Headcounts `n[r,k,t]` are integers. Investment starts `z[i,t]` and high-performance activity `h[t]` are binary. Production `q[f,p,t]`, shipments `x[f,m,p,t]`, sales `y[m,p,t]`, prices `P[m,p,t]`, allocations `a[r,u,t]`, and sales shares are continuous. Pump-volume units are annual planning aggregates; they are not required to be integer individual pumps.

Matrix API arrays mirror these dimensions: headcount `(4,4,3)`, investment starts `(4,3)`, R&D allocation `(4,3,3)`, market decisions `(4,2,3)`, production `(2,2,3)`, shipments `(2,4,2,3)`, and electricity `(2,3)`. Process saving `s[t]`, development stock `d[t]`, and activity have shape `(3,)`. A separate scalar cash auxiliary supplies the linear objective. Every variable has a finite bound derived from scenario data; activity constraints use capacity/demand bounds rather than arbitrary large constants.

The business setup places R&D, sales, and support teams in the US and India. Germany has the existing factory and a local sales/support office. China has a sales/support office throughout the horizon, while its factory opens only after the optional factory investment becomes available. High-performance pumps have higher base demand at reference prices and add development and maintenance obligations. Within each factory they deliberately use the same baseline manufacturing effort, material, and electricity coefficients as standard pumps; scenario validation enforces those equal product coefficients.

### Equations and editable assumptions

In the table, `{r}`, `{f}`, `{m}`, `{p}`, `{k}`, `{i}`, and `{t}` stand for the named YAML axes above. Monetary coefficients use MUSD. `U[i,t] = sum(z[i,tau] for tau < t)` is persistent availability; `open[germany,t]=1`, `open[china,t]=U[china_factory,t]`.

| YAML field(s) | Equation / role | Business meaning |
|---|---|---|
| `assumptions.company_statement`, `money_units`, `volume_units` | Scenario description and required unit declarations | Fictional company; MUSD and annual pump-volume units |
| `solver.time_limit_seconds`, `relative_gap` | SCIP stopping limits | Runtime/quality tradeoff; CLI overrides are recorded separately |
| `solver.feasibility_abs`, `feasibility_rel` | `abs(a-b) <= abs_tol + rel_tol*max(abs(a),abs(b))`; one-sided equivalent for inequalities | Independent numerical verification tolerances |
| `solver.integrality_abs` | `abs(n-round(n)) <= integer_tol`, also for binaries | Separate integrality check |
| `staff.{r}.{k}.minimum.{t}`, `maximum.{t}` | `min <= n <= max`; China manufacturing bounds multiplied by `open` | Annual staffing ranges; zero/zero disables a team |
| `staff.{r}.{k}.salary_musd_per_person.{t}` | `salary[r,t] = sum_k wage[r,k,t]*n[r,k,t]` | Entire team salary charged once |
| `support.fixed_headcount.{r}.{t}`, `support.coverage_ratios.{r}.{rd,manufacturing,sales}.{t}` | `n[support] >= fixed + sum_k ratio[k]*n[k]` | Support scales with local operating teams |
| `regional_budget_musd.{r}.{t}` | `regional_operating_cost[r,t] <= budget[r,t]` | Independent yearly spending authorization; no carryover |
| `office_overhead_musd.{r}.{t}` | Added to local annual operating cost | China's sales/support office remains even before its factory opens |
| `investments.{i}.cost_musd` | `capex[t] = sum_i cost[i]*z[i,t]`; `sum_t z[i,t] <= 1`; `z[i,year_3]=0` | Four optional investments, paid in start year, useful only next year onward |
| `central_allowance_musd.{t}` | `capex[t] <= allowance[t]` | Separate annual investment authorization; year 3 remains explicit |
| `research.regions.{us,india}.alpha.{t}`, `beta.{t}`, `upgrade_alpha_gain` | `Qrd = (alpha + upgrade_gain*U)*n[rd] - beta*n[rd]^2`; `sum_u a <= Qrd` | Concave R&D productivity; upgrade increases linear productivity after its delay |
| `knowledge.initial_process_saving` | `s[1] = initial` | Initial material-saving fraction |
| `knowledge.process_conversion.{t}` | `s[t+1] = s[t] + conversion[t]*sum_r a[r,process,t]` | Process work reduces later-year material consumption |
| `knowledge.max_process_saving`, `material_saving_floor` | `0 <= s <= max_s <= 1-floor` | Saving cap and minimum retained material fraction |
| `knowledge.initial_development_stock` | `d[1] = initial` | Existing development capability |
| `knowledge.max_development_stock` | `0 <= d <= max_d`; `d[t+1] = d[t] + sum_r a[r,development,t]` | Bounded, persistent development stock with one-year delay |
| `knowledge.development_threshold` | `d[t] >= threshold*h[t]` | High-performance product requires prior development |
| `knowledge.maintenance_required.{t}` | `sum_r a[r,maintenance,t] >= maintenance[t]*h[t]` | Same-year R&D maintenance to keep the product active |
| `factories.capacity.{f}.{t}`, `germany_capacity_gain.{t}` | `sum_p q[Germany] <= capacity + gain*U[Germany upgrade]`; `sum_p q[China] <= capacity*open` | Physical throughput; no same-year investment benefit |
| `factories.manufacturing_productivity.{f}.{t}`, `manufacturing_effort.{f}.{p}` | `sum_p effort[f,p]*q[f,p,t] <= productivity[f,t]*n[f,manufacturing,t]` | Labor throughput; both products must use the same baseline effort within a factory |
| `factories.overhead_musd.{f}.{t}` | `factory_overhead = overhead*open` | Closed China factory has no factory overhead |
| `materials.requirement_per_unit.{f}.{p}`, `price_musd_per_material.{f}.{t}` | `material[f,t] = material_price*sum_p requirement*q*(1-s[t])` | Bilinear production × retained-material fraction |
| `electricity.baseline.{f}.{t}`, `per_unit.{f}.{p}` | `E[f,t] = baseline*open + sum_p per_unit*q` | Open-factory base load plus production energy |
| `electricity.tariffs.{f}.thresholds`, `marginal_rates_musd` | For block `j`: `C_j=sum_(l<j) rate_l*(b_(l+1)-b_l)`; `bill >= C_j + rate_j*(E-b_j)` | Convex increasing-block epigraph; thresholds start at zero and final block covers maximum energy |
| `shipping_cost_musd_per_unit.{f}.{m}.{p}` | `shipping[f,t] = sum_(m,p) coefficient*x[f,m,p,t]` | Outbound shipping belongs to the factory's regional cost |
| `market.demand_base.{m}.{p}.{t}` | Base term in `y <= base + alpha*e - beta*e^2 - sensitivity*(P-reference)` | Product/market demand ceiling |
| `market.reference_price_musd_per_unit.{m}.{p}.{t}` | Reference in demand response | Price at which the base demand is specified |
| `market.price_min_musd_per_unit.{m}.{p}.{t}`, `price_max_musd_per_unit.{m}.{p}.{t}` | `price_min <= P <= price_max` | Allowed pricing range |
| `market.price_sensitivity.{m}.{p}.{t}` | Subtract `sensitivity*(P-reference)` from demand | Volume response per MUSD/unit price increase |
| `market.sales_alpha.{m}.{t}`, `sales_beta.{m}.{t}` | `e[m,p,t]=staff_max[m,sales,t]*share[m,p,t]`; contribution `alpha*e-beta*e^2` | Concave sales effort; `sum_p e <= n[sales]` and `sum_p share <= 1` prevent reusing a full team in both products |

Additional model relationships join these coefficients:

- `q[f,p,t] = sum_m x[f,m,p,t]` and `y[m,p,t] = sum_f x[f,m,p,t]`: all production ships and all sales arrive; there is no inventory.
- `sum_f q[f,high,t] <= Qhigh_max[t]*h[t]` and `y[m,high,t] <= Dhigh_max[m,t]*h[t]`: inactive high-performance products cannot be produced or sold. Active products may validly have zero volume.
- Revenue is `sum_(m,p) P[m,p,t]*y[m,p,t]`, a bilinear price × volume expression. Shipments themselves never generate a second revenue entry.
- Regional operating cost is local salaries + office overhead + local factory material + electricity + open-factory overhead + outbound shipping. US and India have no manufacturing cost. The verifier uses the exact marginal-block electricity bill, allowing solver epigraph values to be greater.
- Net cash per year is revenue − regional operating costs − start-year capex. Cumulative cash is the sum over three years. A scalar auxiliary satisfies `cash_auxiliary <= cumulative_cash_expression` and is maximized linearly, allowing nonlinear expressions in constraints while retaining a linear objective.

The sales response uses headcount-equivalent effort derived from the configured maximum team and its share. It does not multiply a share by a changing integer team inside the quadratic response, which would introduce an unnecessary cubic expression. The actual team still limits combined effort.

The R&D curve has marginal output `alpha - 2*beta*n` and reaches its peak at `n = alpha/(2*beta)`. With the default coefficients, that peak is 10 people in the US and 12.5 in India, above the permitted maxima of 6 and 8, so the editable range shows increasing output with diminishing marginal returns. To explore eventual decline without invalidating the scenario, an edited US assumption of `alpha: 8` and `beta: 1` gives output 16 at four people and 12 at six people before an upgrade; output remains nonnegative across the allowed two-to-six-person range. This is an edit example, not a description of the default result.

The tariff epigraph is the maximum of its affine block lines because marginal rates increase. Reported bills are computed by filling each marginal block from physical electricity use. The verifier checks every array's shape and finite values before arithmetic, all decision nonnegativity/integrality, investment timing, staffing/support, R&D, knowledge recurrences, product prerequisites, capacity/labor, demand/pricing/effort, flows, electricity, budgets, and the cash inequality. It returns all detected violations rather than accepting only a solver status.

### Interpretation and limitations

Authorization budgets restrict annual spending; they are not income, cash balances, financing, or carryover accounts. Capex is subtracted in its start year. There is no depreciation, tax, interest, financing, discounting, salvage value, or balance-sheet cash constraint, so net cash here is distinct from accounting profit.

The three-year horizon creates end effects. Final-year process/development R&D has no payoff inside the horizon; required staffing and product maintenance can still consume resources then. Investment starts are forbidden in the final year because their benefits would begin after the modeled horizon. Staffing is chosen independently in each year with no hiring/firing or ramp-up costs.

Other omissions include inventory, stochastic demand, price competition, substitution/cannibalization between products, exchange rates, and detailed factory scheduling. Data validation prevents malformed inputs but does not establish that assumptions represent a real business.

A single solve reports a jointly chosen plan. It cannot identify causal employee productivity, investment payback, or returns attributable to a specific R&D use. Teams, capacity, knowledge, prices, and markets interact. R&D salaries are shared costs charged once; allocating the same salary independently to process-saving and new-product “returns” would double-count it. Controlled scenario comparisons and an explicit attribution method would be needed for those questions.

### Local development checks

With Python 3.12 and uv 0.12.13 available on the host, from the lab directory:

```bash
uv sync --frozen
uv run pytest
uv run ruff check src
uv run ruff format --check src
uv run mypy src
uv run deptry .
```

Tests are colocated with their modules under `src/app/`. They include numerical adversarial verification, real solver integration, artifact contents/preservation, and command behavior. Container runtime dependencies exclude development tools.

## Clean up

Exit the container shell, then stop and remove the service:

```bash
exit
docker compose down
```

The bind-mounted `output/` directory remains on your host. Remove it with your file manager when you no longer need the reports.
