import SwiftUI

struct TankDetailView: View {
    @EnvironmentObject var phone: PhoneBridge
    let tank: TankRoute

    var body: some View {
        let ctx = phone.context
        let pct = WatchContextReader.intKey(tank.pctKey, in: ctx)
        let fill = WatchContextReader.intKey(tank.fillKey, in: ctx)
        let unit = (ctx["unitLabel"] as? String) ?? "gal"
        let isFill = WatchContextReader.boolKey(tank.fillModeKey, in: ctx, default: true)

        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(tank.rawValue)
                    .font(.title3.bold())

                Text("\(pct)%")
                    .font(.system(.title2, design: .rounded))
                    .bold()
                    .foregroundStyle(WatchContextReader.bandColor(fillPct: fill))

                ProgressView(value: Double(min(pct, 100)), total: 100)
                    .tint(WatchContextReader.bandColor(fillPct: fill))

                Text(isFill ? "Mode: Fill" : "Mode: Drain")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("Top: \(WatchContextReader.stringKey(tank.topKey, in: ctx)) \(unit)")
                Text("Btm: \(WatchContextReader.stringKey(tank.btmKey, in: ctx)) \(unit)")
                Text("Tank total: \(WatchContextReader.stringKey(tank.dispKey, in: ctx)) \(unit)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 6) {
                    Button("Reset tank") {
                        phone.sendAction("resetTank", tank: tank.phoneName)
                    }
                    Button(isFill ? "→ Drain" : "→ Fill") {
                        phone.sendAction("toggleTankFillDrain", tank: tank.phoneName)
                    }
                }
                .font(.caption2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
        }
        .navigationTitle(tank.rawValue)
    }
}
