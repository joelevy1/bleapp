import SwiftUI

struct ContentView: View {
    @EnvironmentObject var phone: PhoneBridge

    var body: some View {
        NavigationView {
            Group {
                if phone.shouldShowHome {
                    HomeContentView()
                } else {
                    WaitingConnectView()
                }
            }
        }
    }
}

// MARK: - Waiting

struct WaitingConnectView: View {
    @EnvironmentObject var phone: PhoneBridge

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Waiting to connect")
                .font(.headline)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var subtitle: String {
        if !phone.isBoatConnected {
            return "Open Ballast Monitor on your iPhone and connect to the boat (BLE or WiFi)."
        }
        if phone.context["v"] == nil {
            return "Open Ballast Monitor on your iPhone so tank data can sync to your watch."
        }
        return "Data from the phone is out of date. Keep the iPhone app open and connected."
    }
}

// MARK: - Home

struct HomeContentView: View {
    @EnvironmentObject var phone: PhoneBridge

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                StatusHeaderView()

                Text("Ballast")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let total = phone.context["totalDisp"] as? String, !total.isEmpty {
                    Text("Total \(total) \(unitLabel)")
                        .font(.caption)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(.secondary)
                }

                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)],
                    spacing: 6
                ) {
                    ForEach(TankRoute.allCases, id: \.self) { tank in
                        NavigationLink(destination: TankDetailView(tank: tank)) {
                            TankCell(tank: tank)
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 6) {
                    Button("Reset all") { phone.sendAction("resetAll") }
                    Button("All fill/drain") { phone.sendAction("toggleFillDrain") }
                }
                .font(.caption2)

                UnitPickerRow()
                    .padding(.top, 4)
            }
            .padding(.horizontal, 4)
        }
    }

    private var unitLabel: String {
        (phone.context["unitLabel"] as? String) ?? "gal"
    }
}

struct StatusHeaderView: View {
    @EnvironmentObject var phone: PhoneBridge

    var body: some View {
        HStack {
            Circle()
                .fill(Color.green)
                .frame(width: 6, height: 6)
            Text(connLabel)
                .font(.caption2)
            Spacer()
            Text(modeLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var connLabel: String {
        let conn = (phone.context["conn"] as? String) ?? ""
        if conn.uppercased() == "WIFI" { return "WiFi" }
        return "BLE"
    }

    private var modeLabel: String {
        let global = phone.context["globalFill"] as? Bool ?? true
        return global ? "Fill" : "Drain"
    }
}

struct UnitPickerRow: View {
    @EnvironmentObject var phone: PhoneBridge

    private let modes: [(id: String, label: String)] = [
        ("counter", "Cnt"),
        ("gallons", "Gal"),
        ("pounds", "Lbs"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Units")
                .font(.caption2)
                .foregroundStyle(.secondary)
            HStack(spacing: 4) {
                ForEach(modes, id: \.id) { mode in
                    Button(mode.label) {
                        phone.sendAction("setUnit", unit: mode.id)
                    }
                    .font(.caption2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(phone.unitMode == mode.id ? Color.accentColor.opacity(0.35) : Color.gray.opacity(0.25))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
    }
}

struct TankCell: View {
    @EnvironmentObject var phone: PhoneBridge
    let tank: TankRoute

    var body: some View {
        let ctx = phone.context
        let pct = WatchContextReader.intKey(tank.pctKey, in: ctx)
        let fill = WatchContextReader.intKey(tank.fillKey, in: ctx)
        let disp = WatchContextReader.stringKey(tank.dispKey, in: ctx)
        let unit = (ctx["unitLabel"] as? String) ?? "gal"

        VStack(alignment: .leading, spacing: 2) {
            Text(tank.rawValue)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(pct)%")
                .font(.system(.title3, design: .rounded))
                .bold()
                .foregroundStyle(WatchContextReader.bandColor(fillPct: fill))
            ProgressView(value: Double(min(pct, 100)), total: 100)
                .tint(WatchContextReader.bandColor(fillPct: fill))
            Text("\(disp) \(unit)")
                .font(.caption2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(6)
        .background(Color.gray.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
