# PulseHide 🛰️
> **Advanced Command & Control (C2) Beacon Simulation, Multi-Phase Detection & Evasion Benchmarking Platform.**

PulseHide is a cybersecurity simulation and network traffic analysis framework designed to evaluate and benchmark C2 beacon detection algorithms against sophisticated evasion strategies, including coordinated multi-host burst synchronized hopping and interval jittering.

---

## ⚡ Core Architecture

PulseHide models how modern adversary C2 channels shift behavior across operational phases and provides statistical detection pipelines to distinguish true threats from lookalike benign traffic.

```
PulseHide/
├── app/                  # Next.js 14 App Router (UI & API Routes)
│   ├── api/              # REST Endpoints for simulation and detection runs
│   ├── dashboard/        # Threat intelligence & detection analytics UI
│   ├── layout.tsx        # Root layout & theme providers
│   └── page.tsx          # Landing & overview
├── lib/
│   ├── db.ts             # Cached Mongoose connection helper with DNS fallback
│   ├── types.ts          # Core domain models, ScenarioConfig, and GroundTruth
│   ├── simulator.ts      # Deterministic Mulberry32 2-phase simulation engine
│   ├── detector.ts       # Multi-phase statistical beacon detector & Jaccard clustering
│   └── evaluator.ts      # Precision, Recall, F1, and confusion matrix benchmarking
├── .env.local.example    # Environment variable template
└── tailwind.config.ts    # Styling & UI tokens
```

---

## 🔬 How It Works

### 1. Two-Phase Threat Simulation (`lib/simulator.ts`)
Driven by an isolated, deterministic **Mulberry32 Pseudo-Random Number Generator (PRNG)** for 100% reproducible experiments:

* **Phase 1 (Fixed-Interval Regularity)**:
  * **Compromised Hosts**: Emit beacons on a fixed interval (`phase1IntervalMs`) with minor jitter (`± phase1NoiseMs`).
  * **Benign-Regular (Lookalike Trap)**: Emit beacons with identical interval/noise parameters to stress-test false-positive filters.
  * **Plain Benign & Bursty**: Emit uncorrelated events with random inter-arrival intervals in $[ \frac{\text{interval}}{2}, 2 \cdot \text{interval} ]$.

* **Phase 2 (Coordinated Burst Evasion)**:
  * **Compromised Hosts**: Switch to coordinated multi-host bursts within shared temporal windows (`phase2BurstWindowMs`) across each period (`phase2BurstPeriodMs`), accompanied by background jitter noise (`phase2JitterMinMs` to `phase2JitterMaxMs`).
  * **Benign-Bursty Hosts**: Emit independent, sparse bursts with uncoordinated slot timings.
  * **Benign-Regular & Plain Benign**: Continue baseline traffic unchanged.

---

### 2. Multi-Phase Detection Pipeline (`lib/detector.ts`)

#### Phase 1: Interval Regularity Scoring (`scorePhase1`)
Measures the Coefficient of Variation ($CV$) of inter-arrival intervals $\Delta t = t_{i+1} - t_i$:

$$CV = \frac{\sigma(\Delta t)}{\mu(\Delta t)}$$

$$\text{Score}_{\text{P1}} = \min\left(1, \max\left(0, \frac{1}{1 + 10 \cdot CV}\right)\right)$$

* Highly periodic traffic ($CV \to 0$) yields $\approx 0.78 - 1.00$.
* High-variance random traffic ($CV \ge 0.35$) yields $\le 0.22$.

#### Phase 2: Coordinated Multi-Host Clustering (`scorePhase2`)
Partitions time into discrete buckets matching the burst window width ($10\text{s}$) and computes pairwise **Jaccard Similarity** over active bucket sets:

$$J(H_a, H_b) = \frac{|\text{Buckets}(H_a) \cap \text{Buckets}(H_b)|}{|\text{Buckets}(H_a) \cup \text{Buckets}(H_b)|}$$

Uses **Top-$K$ Peer Averaging ($K=4$)**:
$$\text{Score}_{\text{P2}}(H_a) = \frac{1}{K} \sum_{j \in \text{Top-4 peers}} J(H_a, H_j)$$

*Prevents dilution by background benign hosts and isolates coordinated botnet clusters.*

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** 18.17+ or 20+
* **npm** / **pnpm** / **yarn**
* **MongoDB Atlas** or a local MongoDB instance

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Krithik0908/PulseHide.git
   cd PulseHide
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.local.example .env.local
   ```
   Open `.env.local` and configure your MongoDB connection string:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/pulsehide?retryWrites=true&w=majority
   ```

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Verification & Quality Checks

Run the TypeScript typecheck:
```bash
npx tsc --noEmit
```

Run ESLint:
```bash
npm run lint
```

---

## 📊 Default Benchmark Scenario

| Parameter | Default Value | Description |
|---|---|---|
| `seed` | `42` | PRNG seed for deterministic runs |
| `totalHosts` | `20` | Total simulated network hosts |
| `compromisedHostIds` | `host-01` … `host-05` (5) | Coordinated C2 beaconing nodes |
| `benignRegularHostIds` | `host-06` … `host-08` (3) | Periodic lookalike baseline hosts |
| `benignBurstyHostIds` | `host-09` … `host-11` (3) | Independent burst hosts |
| `phase1DurationMs` | `3,600,000` (1 hr) | Phase 1 duration |
| `phase2DurationMs` | `3,600,000` (1 hr) | Phase 2 duration |
| `phase1IntervalMs` | `60,000` (60s) | Base Phase 1 interval |
| `phase1NoiseMs` | `3,000` (±3s) | Phase 1 interval jitter |
| `phase2BurstWindowMs` | `10,000` (10s) | Coordinated burst window width |
| `phase2BurstPeriodMs` | `300,000` (5 min) | Interval between burst windows |

---

## 📄 License
This project is licensed under the MIT License.
