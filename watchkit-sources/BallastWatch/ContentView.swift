import SwiftUI

struct ContentView: View {
    @EnvironmentObject var phone: PhoneBridge

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 6) {
                    Text("Ballast")
                        .font(.headline)
                        .frame(maxWidth: .infinity, alignment: .leading)

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
                        Button("Reset") { phone.sendAction("resetAll") }
                        Button("Fill/Dr") { phone.sendAction("toggleFillDrain") }
                    }
                    .font(.caption2)

                    Button("Disconnect") { phone.sendAction("disconnect") }
                        .font(.caption2)
                }
                .padding(.horizontal, 4)
            }
        }
    }
}

enum TankRoute: String, CaseIterable, Hashable {
    case port = "Port"
    case starboard = "Starboard"
    case mid = "Mid"
    case forward = "Forward"
}

struct TankCell: View {
    @EnvironmentObject var phone: PhoneBridge
    let tank: TankRoute

    var body: some View {
        let pct = intKey(tank.pctKey)
        let fill = intKey(tank.fillKey)
        let disp = stringKey(tank.dispKey)
        let unit = (phone.context["unitLabel"] as? String) ?? "gal"

        VStack(alignment: .leading, spacing: 2) {
            Text(tank.rawValue)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(pct)%")
                .font(.system(.title3, design: .rounded))
                .bold()
                .foregroundStyle(bandColor(fillPct: fill))
            Text("\(disp) \(unit)")
                .font(.caption2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(6)
        .background(Color.gray.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

extension TankRoute {
    var pctKey: String {
        switch self {
        case .port: return "portPct"
        case .starboard: return "stbdPct"
        case .mid: return "midPct"
        case .forward: return "fwdPct"
        }
    }
    var fillKey: String {
        switch self {
        case .port: return "portFill"
        case .starboard: return "stbdFill"
        case .mid: return "midFill"
        case .forward: return "fwdFill"
        }
    }
    var dispKey: String {
        switch self {
        case .port: return "portDisp"
        case .starboard: return "stbdDisp"
        case .mid: return "midDisp"
        case .forward: return "fwdDisp"
        }
    }
}
