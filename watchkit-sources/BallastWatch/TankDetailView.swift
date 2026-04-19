import SwiftUI

struct TankDetailView: View {
    @EnvironmentObject var phone: PhoneBridge
    let tank: TankRoute

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(tank.rawValue)
                    .font(.title3.bold())

                let pct = intKey(tank.pctKey)
                let fill = intKey(tank.fillKey)
                Text("Display: \(pct)%")
                    .foregroundStyle(bandColor(fillPct: fill))
                ProgressView(value: Double(min(pct, 100)), total: 100)

                Text(modeLine)
                    .font(.caption)

                let unit = (phone.context["unitLabel"] as? String) ?? "gal"
                Text("Top: \(topVal) \(unit)")
                Text("Btm: \(btmVal) \(unit)")
                Text("Tank total: \(tankTotal) \(unit)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
        }
        .navigationTitle(tank.rawValue)
    }

    private var modeLine: String {
        let k = fillModeKey
        let v = phone.context[k] as? Bool ?? true
        return v ? "Mode: Fill" : "Mode: Drain"
    }

    private var fillModeKey: String {
        switch tank {
        case .port: return "fillPort"
        case .starboard: return "fillStbd"
        case .mid: return "fillMid"
        case .forward: return "fillFwd"
        }
    }

    private var topVal: String {
        stringKey(topKey)
    }
    private var btmVal: String {
        stringKey(btmKey)
    }
    private var tankTotal: String {
        stringKey(tank.dispKey)
    }

    private var topKey: String {
        switch tank {
        case .port: return "portTop"
        case .starboard: return "stbdTop"
        case .mid: return "midTop"
        case .forward: return "fwdTop"
        }
    }
    private var btmKey: String {
        switch tank {
        case .port: return "portBtm"
        case .starboard: return "stbdBtm"
        case .mid: return "midBtm"
        case .forward: return "fwdBtm"
        }
    }

    private func intKey(_ key: String) -> Int {
        if let n = phone.context[key] as? Int { return n }
        if let n = phone.context[key] as? NSNumber { return n.intValue }
        return 0
    }

    private func stringKey(_ key: String) -> String {
        if let s = phone.context[key] as? String { return s }
        if let n = phone.context[key] as? NSNumber { return n.stringValue }
        return "—"
    }

    private func bandColor(fillPct: Int) -> Color {
        if fillPct <= 75 { return .green }
        if fillPct <= 90 { return .yellow }
        return .red
    }
}
