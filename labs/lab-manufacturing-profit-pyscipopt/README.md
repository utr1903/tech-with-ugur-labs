# Manufacturing profit planning with PySCIPOpt

A factory sells one product at a fixed price. Plan three years of production,
manufacturing workers, researchers, and one optional expansion to maximize
cumulative net cash. Demand and factory capacity limit sales. Research costs
salaries now and lowers unit production cost from the following year onward.

All figures are synthetic teaching assumptions. They are not estimates of real
wages, prices, productivity, or demand.

Read the companion post: [Plan three years of manufacturing cash with NumPy and PySCIPOpt](https://techwithugur.dev/posts/manufacturing-profit-pyscipopt/).

## The planning problem

The scenario fixes the selling price, annual demand limits, initial and minimum
unit costs, staff salaries and limits, worker productivity, factory capacity,
research savings, expansion cost and capacity, and solver stopping settings.

The solver builds one coordinated three-year plan. It chooses:

- manufacturing workers;
- researchers;
- whether to start the one permitted expansion;
- continuous production volume; and
- unit production cost, an equation-derived value implied by earlier research.

Production is a planning volume, so it may be fractional even though individual
products are not. Every unit produced is sold in the same year. There is no
inventory, backlog, separate shipment decision, or variable selling price.
Workers and researchers are integers; expansion starts are binary. Staffing may
change independently between years because there are no hiring or firing links.

Research has diminishing returns. The first researcher saves $4 per future unit,
the second adds $3, and the third adds $2. Savings begin one year after the
salary is paid, then persist. This illustrative calculation explains the timing;
it is not a claim about the optimal plan:

| Year | Researchers | New saving | Unit cost used that year |
|---:|---:|---:|---:|
| 1 | 2 | $7/unit | $50/unit |
| 2 | 1 | $4/unit | $43/unit |
| 3 | 0 | $0/unit | $39/unit |

Year 1 still uses the initial $50 cost. Its two researchers create $7 of saving
for year 2. The year-2 researcher adds $4, so year 3 keeps the earlier $7 and
uses $11 of cumulative saving. Research in year 3 cannot affect a modeled year,
so its salary has no benefit within this horizon.

## Run the lab

The container stays running so you can edit the mounted YAML or Python source
and rerun without rebuilding:

```bash
git clone https://github.com/utr1903/tech-with-ugur-labs.git
cd tech-with-ugur-labs/labs/lab-manufacturing-profit-pyscipopt
docker compose up -d --build
docker compose exec lab sh
python -m app
```

Run `python -m app` inside the container shell. The default measured run produces
this plan (SCIP may retain tiny raw numerical residuals in CSV and JSON):

```text
Verified annual manufacturing plan
Units: people (Wkr/Rsr); flags (Start/Avail); product units (Units); USD/unit (Cost/Save); USD/year (Rev/Prod/Wkr$/Rsr$/Expand/Net).
Yr Wkr Rsr Start Avail      Units    Cost New save         Rev        Prod       Wkr$       Rsr$      Expand         Net
 1   4   3     1     0   4,000.00   50.00     9.00  360,000.00  200,000.00  80,000.00  30,000.00   50,000.00        0.00
 2   6   3     0     1   6,000.00   41.00     9.00  540,000.00  246,000.00 120,000.00  30,000.00        0.00  144,000.00
 3   6   0     0     1   6,000.00   32.00     0.00  540,000.00  192,000.00 120,000.00       0.00        0.00  228,000.00

Total net cash: $372,000.00
Solver status: optimal
Relative gap: 0.000000%
Solver objective: $372,000.00
```

The factory pays for expansion in year 1. Capacity remains 4,000 units that year,
then rises to 6,000 in years 2 and 3. Research follows the same delayed logic:
three researchers in each of the first two years reduce later unit costs, while
year-3 research stays at zero.

## Understand the inputs

`scenario.yaml` has four business groups followed by solver controls. Every money
value is in USD, production and demand are actual product units per year, and
staff values are people.

| YAML input | What it controls |
|---|---|
| `product.selling_price_usd_per_unit` | Fixed revenue per unit in every year. |
| `product.demand_units.year_1..year_3` | Maximum same-year production and sales. |
| `manufacturing.initial_unit_cost_usd` | Year-1 materials-and-electricity cost per unit, excluding salaries. |
| `manufacturing.minimum_unit_cost_usd` | Cost floor that limits accumulated research savings. |
| `manufacturing.units_per_worker_per_year` | Annual production one worker can support. |
| `manufacturing.worker_salary_usd_per_year` | Salary charged separately for each worker in that year. |
| `manufacturing.max_workers` | Largest independently chosen worker team in any year. |
| `manufacturing.capacity_units_per_year` | Physical output limit before expansion is available. |
| `research.researcher_salary_usd_per_year` | Salary charged in the year research is performed. |
| `research.max_researchers` | Largest independently chosen research team in any year. |
| `research.first_researcher_saving_usd_per_unit` | Next-year saving contributed by the first researcher. |
| `research.saving_drop_per_additional_researcher` | Reduction in each later researcher's marginal saving. |
| `expansion.cost_usd` | One-time payment in the year expansion starts. |
| `expansion.extra_capacity_units_per_year` | Extra annual capacity beginning the next year. |
| `solver.time_limit_seconds` | Maximum SCIP solve time. |
| `solver.relative_gap` | Gap at which SCIP may stop before proving exact optimality. |

The loader requires exactly these fields. Unknown or missing keys, non-finite
numbers, invalid ranges, and research settings that permit a negative marginal
saving fail before model construction. The horizon is deliberately fixed at
three years; only the three demand values vary by year.

## Follow the equations

The names and order below match `model.py`. The subscript $t$ means year
$t \in \{1,2,3\}$; arrays in Python use the same year order. For readability,
input names below use spaces instead of underscores and omit unit suffixes.
For example, “worker output” is `units_per_worker_per_year`, “initial cost” is
`initial_unit_cost_usd`, and “price” is `selling_price_usd_per_unit`. The input
table above gives their full YAML names and units.

### Variable types and bounds

Workers and researchers are whole people. Expansion starts are binary, with the
last year's start fixed at zero because its benefit would fall outside the horizon:

$$
\begin{aligned}
\mathrm{workers}_t &\in \mathbb{Z},
&0 \le \mathrm{workers}_t &\le \text{max workers} \\
\mathrm{researchers}_t &\in \mathbb{Z},
&0 \le \mathrm{researchers}_t &\le \text{max researchers} \\
\mathrm{expansion\_start}_t &\in \{0,1\},
&\mathrm{expansion\_start}_3 &= 0
\end{aligned}
$$

Production is continuous volume in units/year. Before adding the timed capacity
constraints, the code computes a safe annual upper bound, $U_t$:

$$
U_t = \min\!\left\{
\begin{aligned}
&\mathrm{demand}_t, \\
&\text{max workers} \times \text{worker output}, \\
&\text{base capacity} + \text{extra capacity}
\end{aligned}
\right\}
$$

$$
\begin{aligned}
\mathrm{units\_produced}_t &\in \mathbb{R},
&0 \le \mathrm{units\_produced}_t &\le U_t \\
\mathrm{unit\_cost}_t &\in \mathbb{R},
&\text{minimum cost} \le \mathrm{unit\_cost}_t &\le \text{initial cost}
\end{aligned}
$$

Unit cost is USD/unit. Its bounds do not determine it by themselves: the research
equations below fix its value. The production bound allows expanded capacity in
principle; the next constraints enforce when that capacity actually becomes available.

### Decisions and capacity

Production must respect worker output and demand in every year:

$$
\begin{aligned}
\mathrm{units\_produced}_t
&\le \mathrm{workers}_t \times \text{worker output} \\
\mathrm{units\_produced}_t &\le \mathrm{demand}_t
\end{aligned}
$$

At most one expansion may start. Availability contains only earlier starts:
a year-1 start gives `[0, 1, 1]`; a year-2 start gives `[0, 0, 1]`.
Availability is a derived expression, not another decision variable.

$$
\begin{aligned}
\sum_{t=1}^{3} \mathrm{expansion\_start}_t &\le 1 \\
\mathrm{expansion\_available}_t
&= \sum_{k=1}^{t-1} \mathrm{expansion\_start}_k \\
\mathrm{units\_produced}_t
&\le \text{base capacity} \\
&\quad + \text{extra capacity} \times \mathrm{expansion\_available}_t
\end{aligned}
$$

The empty sum for year 1 is zero. The investment never increases capacity in its
payment year. Worker teams are chosen independently each year, with no hiring,
firing, or ramp-up cost.

### Research and unit cost

For $r = \mathrm{researchers}_t$, new saving is the sum of an arithmetic sequence.
“First saving” is `first_researcher_saving_usd_per_unit`; “saving drop” is
`saving_drop_per_additional_researcher`. The result is USD per future unit:

$$
\mathrm{new\_saving}_t
= \text{first saving} \times r
- \text{saving drop} \times \frac{r(r-1)}{2}
$$

$$
\begin{aligned}
\mathrm{unit\_cost}_1 &= \text{initial cost} \\
\mathrm{unit\_cost}_{t+1}
&= \mathrm{unit\_cost}_t - \mathrm{new\_saving}_t
&&\text{for } t \in \{1,2\} \\
\mathrm{unit\_cost}_t &\ge \text{minimum cost}
&&\text{for } t \in \{1,2,3\}
\end{aligned}
$$

The term $r(r-1)$ makes research savings nonlinear. Savings accumulate because
each next-year cost starts from the current cost. The minimum is enforced by the
variable's lower bound: the solver must choose research staffing that respects
it; the code does not silently clip a result. There is no year-4 cost equation.

### Cumulative net cash and objective

For each year, revenue and spending are in USD. “Worker salary” and “researcher
salary” are the annual salary inputs; “expansion cost” is `expansion.cost_usd`.

$$
\begin{aligned}
\mathrm{revenue}_t &= \text{price} \times \mathrm{units\_produced}_t \\
\mathrm{production\_cost}_t
&= \mathrm{unit\_cost}_t \times \mathrm{units\_produced}_t \\
\mathrm{worker\_salaries}_t &= \text{worker salary} \times \mathrm{workers}_t \\
\mathrm{researcher\_salaries}_t
&= \text{researcher salary} \times \mathrm{researchers}_t \\
\mathrm{expansion\_spending}_t
&= \text{expansion cost} \times \mathrm{expansion\_start}_t \\
\mathrm{annual\_net\_cash}_t
&= \mathrm{revenue}_t - \mathrm{production\_cost}_t \\
&\quad - \mathrm{worker\_salaries}_t - \mathrm{researcher\_salaries}_t \\
&\quad - \mathrm{expansion\_spending}_t
\end{aligned}
$$

The business objective is:

$$
\max \; \sum_{t=1}^{3} \mathrm{annual\_net\_cash}_t
$$

Production cost includes materials and electricity. Worker and researcher
salaries are separate costs. The product
$\mathrm{unit\_cost}_t \times \mathrm{units\_produced}_t$ is the second nonlinear
expression in the model.

Because PySCIPOpt's objective interface is linear, `model.py` creates one
continuous scalar `cash_auxiliary`, measured in USD. The solver maximizes it
subject to the nonlinear cash constraint:

$$
\begin{aligned}
\max \;&\mathrm{cash\_auxiliary} \\
\text{subject to }\;&\mathrm{cash\_auxiliary}
\le \sum_{t=1}^{3} \mathrm{annual\_net\_cash}_t
\end{aligned}
$$

Its finite bounds use $U_{\mathrm{total}} = \sum_{t=1}^{3} U_t$. The lower bound
covers maximum possible production spending, both maximum teams in all three
years, and one expansion. Ignoring revenue here makes it safely conservative.
The upper bound is maximum possible revenue before any spending:

$$
\begin{aligned}
L_{\mathrm{cash}} = -\bigl(&\text{initial cost} \times U_{\mathrm{total}} \\
&+ 3 \times \text{worker salary} \times \text{max workers} \\
&+ 3 \times \text{researcher salary} \times \text{max researchers} \\
&+ \text{expansion cost}\bigr) \\
U_{\mathrm{cash}} &= \text{price} \times U_{\mathrm{total}} \\
\mathrm{cash\_auxiliary} &\in \mathbb{R} \\
L_{\mathrm{cash}} \le \mathrm{cash\_auxiliary} &\le U_{\mathrm{cash}}
\end{aligned}
$$

This teaching objective treats cumulative net cash as profit planning. Expansion
is paid immediately. There is no depreciation, tax, discounting, financing,
salvage value, or cash-balance constraint.

## Read the model setup logs

At the default `LOG_LEVEL=info`, construction emits JSON logs after each variable
and constraint is successfully added. Variable events include its SCIP name,
type, and numeric lower and upper bounds. Constraint events include a descriptive
name, the mathematical expression with the scenario's coefficients, and its
bounds; `null` means that side is unbounded. The objective is logged after it is
set, too.

SCIP variable names use zero-based indices: `workers_0` means the year-1 worker
team, `workers_1` means year 2, and `workers_2` means year 3. Constraint names use
explicit year numbers. The logged equations collect variable terms on one side;
for example, `1 * units_produced_0 - 1000 * workers_0 <= 0` is the same staffing
constraint as the README's production inequality. These are model definitions,
not solved decision values; the verified annual table follows the solve.

## Read the result files

The console rounds display values to two decimals and normalizes monetary zero.
`annual_plan.csv` contains one row per year and keeps the raw verified floats.
Its columns cover the decisions, delayed expansion availability, new research
saving, revenue, production cost, both salaries, expansion spending, and annual
net cash. Counts are people, flags are zero or one, volume is units/year, unit
cost and saving are USD/unit, and annual money columns are USD/year.

`solution.json` keeps raw decision arrays, the exact input-byte SHA-256, effective
solver settings, status, objective, bound, gap, solve time, verifier tolerances,
and recomputed cash. SCIP's scalar objective can differ slightly from recomputed
cash because of numerical tolerances. The console reports a difference only when
it rounds to at least one cent; the raw JSON always preserves it.

Both files are fully serialized before existing targets are touched, then written
through temporary files. A failed solve or verification leaves existing results
unchanged. The two final file replacements are sequential, so interruption during
that short step is not a cross-file transaction. Use separate output directories
for simultaneous or retained runs.

## Read the implementation

Follow the business data in this order:

```text
scenario.yaml -> scenario.py -> model.py -> solver.py -> verification.py -> results.py
```

`scenario.py` validates and freezes the inputs. `model.py` defines variables,
constraints, and the objective. `solver.py` configures SCIP and extracts raw
values only when an incumbent exists. `verification.py` independently recomputes
the business rules and annual cash. `results.py` writes the two artifacts and the
console table. `commands/run.py` coordinates one run; `__main__.py` parses CLI
arguments and maps domain failures to exit codes.

The small, fixed teaching model keeps these business modules flat under
`src/app/` so the equations remain visible together. This is a deliberate
exception to grouping a larger application's domains into packages.

## Solver and verification

`optimal` means SCIP proved optimality within its numerical tolerances.
`gaplimit` means it stopped after the configured bound-to-incumbent gap was met.
`timelimit` means it reached the time limit. A gap- or time-limited run may still
have a usable incumbent; a run without one produces no replacement artifacts.
The reported relative gap is SCIP's statistic for the scalar objective.

Before output is written, the independent verifier checks array shapes, finite
values, integrality, bounds, expansion timing, delayed research recurrence,
staffing output, demand, physical capacity, the cost floor, and cash arithmetic.
It uses NumPy arithmetic and does not reuse the model expressions.

Exit codes are `0` for a verified result, `2` for invalid input, `3` for no
incumbent, `4` for failed verification, and `1` for another application error.
Argparse also uses `2` for invalid command syntax.

## Setup and troubleshooting

You need Git and Docker with Docker Compose v2. Docker Desktop works on macOS and
Windows. The first build needs internet access to download the fixed Python image
and locked packages; running the lab afterward needs no host Python installation.

The image pins Python 3.12.14 and uv 0.12.13. Application and development package
versions are pinned in `pyproject.toml` and `uv.lock`.

Inside the container shell, optional arguments are:

```bash
python -m app --help
python -m app --scenario scenario.yaml --output output --time-limit 120 --gap 0.01
```

Omit `--time-limit` and `--gap` to keep the YAML settings. `LOG_LEVEL` defaults to
`info`; `.env.example` documents the mounted environment. Source and scenario
edits take effect on the next run. Dependency, lockfile, or Dockerfile changes
require exiting the shell and running `docker compose up -d --build` again.

If Docker cannot start, confirm the daemon is running and `docker compose version`
works. If a run reports input validation, read the final JSON log's message and
compare the named field with `scenario.yaml`. If it reports no incumbent, try a
larger positive time limit or less restrictive assumptions. Stop this lab with:

```bash
docker compose down
```

## Developer checks

With Python 3.12 and the pinned uv available:

```bash
uv sync --frozen
uv run pytest -q
uv run ruff check
uv run ruff format --check
uv run mypy
uv run deptry .
```

Tests are colocated with their modules under `src/app/`. They cover parsing,
model timing and bounds, small hand-checkable solves, safe no-incumbent handling,
independent verification, artifact preservation, console output, and CLI exits.
