include $(TOPDIR)/rules.mk

PKG_NAME:=kanno-geodata
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/kanno-geodata
  SECTION:=net
  CATEGORY:=Network
  TITLE:=KannoProxy GeoData and Rule Files
  DEPENDS:=+kanno-core
  PKGARCH:=all
endef

define Package/kanno-geodata/description
  Default rule files for KannoProxy. GeoIP/GeoSite data files
  are downloaded at runtime via 'kanno update geodata'.
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/kanno-geodata/install
  $(INSTALL_DIR) $(1)/etc/kanno/rules
  $(INSTALL_DIR) $(1)/etc/kanno/geodata

  $(INSTALL_DATA) ./root/etc/kanno/rules/force_proxy.txt  $(1)/etc/kanno/rules/
  $(INSTALL_DATA) ./root/etc/kanno/rules/force_direct.txt $(1)/etc/kanno/rules/
endef

define Package/kanno-geodata/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
echo "Downloading GeoData (GeoIP + GeoSite)..."
kanno update geodata || echo "GeoData download failed, retry with: kanno update geodata"
exit 0
endef

$(eval $(call BuildPackage,kanno-geodata))
