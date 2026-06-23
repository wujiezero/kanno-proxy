include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-tomfly
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-tomfly
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=TomFly - Beautiful Transparent Proxy UI
  DEPENDS:=+luci-base +tomfly-core +rpcd +rpcd-mod-file
  PKGARCH:=all
endef

define Package/luci-app-tomfly/description
  A beautiful and simple transparent proxy plugin UI for ImmortalWrt,
  supporting mihomo and sing-box kernels with rich protocol support.
  Built as native LuCI (client/JS) views — no Lua runtime required.
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/luci-app-tomfly/install
  $(INSTALL_DIR) $(1)/www/luci-static/resources/tomfly
  $(INSTALL_DIR) $(1)/www/luci-static/resources/view/tomfly
  $(INSTALL_DIR) $(1)/usr/share/luci/menu.d
  $(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
  $(INSTALL_DIR) $(1)/etc/uci-defaults

  $(INSTALL_DATA) ./htdocs/luci-static/resources/tomfly/api.js \
	$(1)/www/luci-static/resources/tomfly/
  $(INSTALL_DATA) ./htdocs/luci-static/resources/tomfly/kernel-profile.js \
	$(1)/www/luci-static/resources/tomfly/
  $(INSTALL_DATA) ./htdocs/luci-static/resources/view/tomfly/style.css \
	$(1)/www/luci-static/resources/view/tomfly/
  $(INSTALL_DATA) ./htdocs/luci-static/resources/view/tomfly/logo.png \
	$(1)/www/luci-static/resources/view/tomfly/
  for v in overview nodes groups rules dns kernel log; do \
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/tomfly/$$v.js \
		$(1)/www/luci-static/resources/view/tomfly/ ; \
  done

  $(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-tomfly.json $(1)/usr/share/luci/menu.d/
  $(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-tomfly.json  $(1)/usr/share/rpcd/acl.d/

  $(INSTALL_BIN) ./root/etc/uci-defaults/90-luci-app-tomfly $(1)/etc/uci-defaults/
endef

define Package/luci-app-tomfly/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null || true
/etc/init.d/uhttpd reload 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,luci-app-tomfly))
